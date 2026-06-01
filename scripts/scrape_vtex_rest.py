"""
scripts/scrape_vtex_rest.py
Scraper VTEX standalone que guarda directamente en Supabase via REST API.
No requiere PostgreSQL directo ni SQLAlchemy — usa el service role key.

Uso:
  python scripts/scrape_vtex_rest.py [walmart] [donjuan] [maxidespensa]
  python scripts/scrape_vtex_rest.py          # todos (walmart + donjuan + maxidespensa)

Nota: Despensa Familiar (familiar) no tiene tienda VTEX propia en .sv —
      opera bajo la misma plataforma que Maxi Despensa.

Requiere variables de entorno (o web/.env.local):
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
"""
import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from decimal import Decimal

# Forzar stdout a utf-8 en Windows (evita UnicodeEncodeError con caracteres especiales)
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ── Cargar .env.local del proyecto web ───────────────────────────────────────
ROOT = Path(__file__).parent.parent
env_local = ROOT / "web" / ".env.local"

if env_local.exists():
    for line in env_local.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
SERVICE_KEY  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SERVICE_KEY:
    print("ERROR: Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

# ── Dependencias ──────────────────────────────────────────────────────────────
import httpx

REST_URL = f"{SUPABASE_URL}/rest/v1"
HEADERS = {
    "apikey":        SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "return=representation",
}
HEADERS_UPSERT = {**HEADERS, "Prefer": "resolution=merge-duplicates,return=representation"}

# ── Scraper VTEX ──────────────────────────────────────────────────────────────
TIENDAS_VTEX = {
    "walmart":      {"base_url": "https://www.walmart.com.sv"},
    "donjuan":      {"base_url": "https://www.ladespensadedonjuan.com.sv"},
    "maxidespensa": {"base_url": "https://www.maxidespensa.com.sv"},
    # "familiar" — no tiene tienda VTEX propia; opera bajo Maxi Despensa
}

VTEX_HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":          "application/json",
    "Accept-Language": "es-SV,es;q=0.9",
}


async def scrape_vtex(key: str) -> list[dict]:
    """Scrape VTEX para una tienda dada. Devuelve lista de productos raw (sin duplicados por sku_local)."""
    base = TIENDAS_VTEX[key]["base_url"]
    productos: list[dict] = []
    skus_vistos: set[str] = set()
    page_size = 50
    desde = 0

    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        while True:
            url = f"{base}/api/catalog_system/pub/products/search"
            params = {"_from": desde, "_to": desde + page_size - 1, "O": "OrderByTopSaleDESC", "map": "c"}
            try:
                resp = await client.get(url, params=params, headers=VTEX_HEADERS)
                resp.raise_for_status()
                items = resp.json()
            except Exception as e:
                print(f"  WARN: Error en página {desde}: {e}")
                break

            if not items:
                break

            for item in items:
                p = _parsear(item, key, base)
                if p and p["sku_local"] not in skus_vistos:
                    skus_vistos.add(p["sku_local"])
                    productos.append(p)

            print(f"  . {key}: {len(productos)} únicos (página {desde//page_size + 1})")
            desde += page_size
            await asyncio.sleep(1.0)

            # Límite de seguridad: 3000 productos únicos por tienda
            if len(productos) >= 3000:
                print(f"  . {key}: límite de 3000 alcanzado")
                break

    return productos


def _parsear(item: dict, key: str, base: str) -> dict | None:
    try:
        skus = item.get("items", [])
        if not skus:
            return None
        sku = skus[0]
        sellers = sku.get("sellers", [])
        if not sellers:
            return None
        offer = sellers[0].get("commertialOffer", {})

        lista = Decimal(str(offer.get("ListPrice") or offer.get("Price") or 0))
        venta = Decimal(str(offer.get("Price") or 0))
        if lista <= 0 and venta <= 0:
            return None

        en_oferta = venta < lista and venta > 0
        precio_normal = float(lista if lista > 0 else venta)
        precio_oferta = float(venta) if en_oferta else None
        descuento_pct = round(float((lista - venta) / lista * 100), 2) if en_oferta and lista > 0 else None

        # EAN
        ean = sku.get("ean") or None
        if not ean:
            for ref in (sku.get("referenceId") or []):
                if isinstance(ref, dict) and ref.get("Key", "").upper() in ("EAN", "GTIN", "EAN13"):
                    v = str(ref.get("Value", "")).strip()
                    if v:
                        ean = v
                        break

        categoria = None
        cats = item.get("categories", [])
        if cats:
            partes = cats[0].strip("/").split("/")
            categoria = partes[0] if partes else None

        imagenes = sku.get("images", [])
        imagen_url = imagenes[0].get("imageUrl") if imagenes else None

        return {
            "supermercado_key": key,
            "nombre_local": (item.get("productName") or "").strip(),
            "marca": (item.get("brand") or "").strip() or None,
            "sku_local": str(item.get("productId", "")),
            "ean": ean,
            "precio_normal": precio_normal,
            "precio_oferta": precio_oferta,
            "en_oferta": en_oferta,
            "descuento_pct": descuento_pct,
            "imagen_url": imagen_url,
            "url_producto": f"{base}/{item.get('linkText', '')}/p",
            "disponible": offer.get("IsAvailable", False),
            "categoria_nombre": categoria,
        }
    except Exception as e:
        return None


# ── Persistencia en Supabase ──────────────────────────────────────────────────

async def rest_get(client: httpx.AsyncClient, table: str, params: dict) -> list[dict]:
    resp = await client.get(f"{REST_URL}/{table}", headers=HEADERS, params=params)
    resp.raise_for_status()
    return resp.json()


async def rest_upsert(client: httpx.AsyncClient, table: str, data: dict | list, on_conflict: str) -> list[dict]:
    h = {**HEADERS_UPSERT, "Prefer": f"resolution=merge-duplicates,return=representation"}
    resp = await client.post(
        f"{REST_URL}/{table}",
        headers=h,
        json=data,
        params={"on_conflict": on_conflict},
    )
    resp.raise_for_status()
    return resp.json()


async def rest_insert(client: httpx.AsyncClient, table: str, data: dict | list) -> list[dict]:
    resp = await client.post(f"{REST_URL}/{table}", headers=HEADERS, json=data)
    resp.raise_for_status()
    return resp.json()


async def cargar_supermercados(client: httpx.AsyncClient) -> dict[str, int]:
    rows = await rest_get(client, "supermercados", {"select": "id,nombre_corto"})
    return {r["nombre_corto"]: r["id"] for r in rows}


async def _filtrar_ya_insertados(
    client: httpx.AsyncClient,
    precios_batch: list[dict],
    ventana_horas: int = 6,
) -> list[dict]:
    """
    Elimina del batch las variantes que ya tienen un precio registrado
    en las últimas `ventana_horas` horas.
    Evita duplicados cuando el scraper se ejecuta más de una vez en el día.
    """
    if not precios_batch:
        return precios_batch

    cutoff = (datetime.now(timezone.utc) - timedelta(hours=ventana_horas)).isoformat()
    var_ids = list({p["variante_id"] for p in precios_batch})
    ya_insertados: set[int] = set()
    CHUNK = 400

    for i in range(0, len(var_ids), CHUNK):
        chunk = var_ids[i:i + CHUNK]
        rows = await rest_get(client, "precios", {
            "select":       "variante_id",
            "variante_id":  f"in.({','.join(str(v) for v in chunk)})",
            "fecha_hora":   f"gte.{cutoff}",
            "limit":        str(len(chunk)),
        })
        for r in rows:
            ya_insertados.add(r["variante_id"])

    if ya_insertados:
        print(f"  Guard: {len(ya_insertados)} variantes ya tienen precio en las últimas {ventana_horas}h — omitidas")

    return [p for p in precios_batch if p["variante_id"] not in ya_insertados]


async def precargar_mapeo_sku(client: httpx.AsyncClient, super_id: int) -> dict[str, int]:
    """
    Carga mapeo_sku validado para este supermercado.
    Retorna {sku_local → producto_id canónico}.
    Aplica a CUALQUIER tienda sin EAN, no solo Selectos.
    """
    mapeo: dict[str, int] = {}
    try:
        rows = await rest_get(client, "mapeo_sku", {
            "select":          "sku_local,producto_id",
            "supermercado_id": f"eq.{super_id}",
            "validado":        "eq.true",
            "rechazado":       "eq.false",
            "limit":           "10000",
        })
        for r in rows:
            mapeo[str(r["sku_local"])] = r["producto_id"]
        if mapeo:
            print(f"  Mapeo validado: {len(mapeo)} entradas (super_id={super_id})")
    except Exception as e:
        print(f"  WARN mapeo_sku: {e}")
    return mapeo


async def guardar_productos(client: httpx.AsyncClient, productos: list[dict], super_map: dict[str, int]) -> dict:
    """
    Para cada producto scraped:
    1. Pre-cargar variantes existentes en memoria (batch query)
    2. Pre-cargar EANs existentes en memoria
    3. Pre-cargar mapeo_sku validado (para productos sin EAN)
    4. Buscar/crear producto por: mapeo_sku → EAN → nombre_normalizado → crear nuevo
    5. Upsert producto_variante (ON CONFLICT supermercado_id,sku_local)
    6. Batch-insert precios
    Retorna resumen { nuevos, actualizados, errores, mapeo_hits }
    """
    nuevos = 0
    actualizados = 0
    errores = 0
    mapeo_hits = 0
    fecha_hora = datetime.now(timezone.utc).isoformat()

    super_key = productos[0]["supermercado_key"] if productos else None
    super_id  = super_map.get(super_key) if super_key else None
    if super_id is None:
        print(f"  ✗ Supermercado '{super_key}' no encontrado en BD")
        return {"nuevos": 0, "actualizados": 0, "errores": len(productos)}

    # ── Pre-cargar variantes existentes para este supermercado ────
    skus_locales = [p["sku_local"] for p in productos if p["sku_local"]]
    variantes_existentes: dict[str, dict] = {}  # sku_local → {id, producto_id}
    CHUNK = 400
    for i in range(0, len(skus_locales), CHUNK):
        chunk = skus_locales[i:i+CHUNK]
        rows = await rest_get(client, "producto_variantes", {
            "select": "id,sku_local,producto_id",
            "supermercado_id": f"eq.{super_id}",
            "sku_local": f"in.({','.join(chunk)})",
        })
        for r in rows:
            variantes_existentes[r["sku_local"]] = r

    # ── Pre-cargar productos por EAN ───────────────────────────────
    eans = [p["ean"] for p in productos if p.get("ean")]
    ean_to_prod: dict[str, int] = {}  # ean → producto_id
    for i in range(0, len(eans), CHUNK):
        chunk = eans[i:i+CHUNK]
        rows = await rest_get(client, "productos", {
            "select": "id,ean",
            "ean": f"in.({','.join(chunk)})",
        })
        for r in rows:
            if r.get("ean"):
                ean_to_prod[r["ean"]] = r["id"]

    # ── Pre-cargar mapeo_sku validado (Capa 1b: mapeo humano) ─────
    mapeo_validado = await precargar_mapeo_sku(client, super_id)

    precios_batch: list[dict] = []

    for prod in productos:
        try:
            sku = prod["sku_local"]
            existente = variantes_existentes.get(sku)

            if existente:
                # Variante ya existe → sólo añadir precio
                variante_id = existente["id"]
                actualizados += 1
            else:
                # Variante nueva → resolver producto + crear variante

                # 1b. Mapeo validado por usuario (prioridad máxima, sin IA)
                producto_id: int | None = mapeo_validado.get(sku)
                if producto_id:
                    mapeo_hits += 1

                # 1a. Buscar producto por EAN (en cache pre-cargado)
                if producto_id is None:
                    producto_id = ean_to_prod.get(prod["ean"]) if prod.get("ean") else None

                # 2. Si no hay EAN match, buscar por nombre normalizado
                if producto_id is None:
                    nombre_norm = prod["nombre_local"].upper().strip()
                    rows = await rest_get(client, "productos", {
                        "select": "id",
                        "nombre_normalizado": f"eq.{nombre_norm}",
                        "limit": "1",
                    })
                    if rows:
                        producto_id = rows[0]["id"]

                # 3. Crear producto nuevo
                if producto_id is None:
                    nombre_norm = prod["nombre_local"].upper().strip()
                    h_insert = {**HEADERS, "Prefer": "return=representation"}
                    resp = await client.post(
                        f"{REST_URL}/productos",
                        headers=h_insert,
                        json={
                            "nombre_normalizado": nombre_norm,
                            "nombre": prod["nombre_local"],
                            "marca": prod["marca"],
                            "ean": prod.get("ean"),
                            "imagen_url": prod.get("imagen_url"),
                            "activo": True,
                        },
                    )
                    if resp.status_code not in (200, 201):
                        errores += 1
                        continue
                    result = resp.json()
                    producto_id = result[0]["id"] if result else None
                    if producto_id and prod.get("ean"):
                        ean_to_prod[prod["ean"]] = producto_id

                if producto_id is None:
                    errores += 1
                    continue

                # 4. Upsert variante (ON CONFLICT supermercado_id,sku_local)
                var_data = {
                    "producto_id": producto_id,
                    "supermercado_id": super_id,
                    "sku_local": sku,
                    "nombre_local": prod["nombre_local"],
                    "imagen_url": prod.get("imagen_url"),
                    "url_producto": prod.get("url_producto"),
                    "activo": True,
                }
                var_result = await rest_upsert(client, "producto_variantes", var_data,
                                               on_conflict="supermercado_id,sku_local")
                variante_id = var_result[0]["id"] if var_result else None
                if variante_id is None:
                    errores += 1
                    continue

                # Añadir al caché para no re-crear en este run
                variantes_existentes[sku] = {"id": variante_id, "producto_id": producto_id}
                nuevos += 1

            # 5. Preparar precio para insert batch
            precios_batch.append({
                "variante_id": variante_id,
                "precio_normal": prod["precio_normal"],
                "precio_oferta": prod.get("precio_oferta"),
                "en_oferta": prod["en_oferta"],
                "descuento_pct": prod.get("descuento_pct"),
                "disponible": prod.get("disponible", True),
                "fecha_hora": fecha_hora,
            })

        except Exception as e:
            errores += 1

    # ── Guard: omitir variantes con precio reciente (< 6h) ────────
    precios_batch = await _filtrar_ya_insertados(client, precios_batch)

    # ── Insert masivo de precios ───────────────────────────────────
    if precios_batch:
        PRICE_CHUNK = 200
        for i in range(0, len(precios_batch), PRICE_CHUNK):
            chunk = precios_batch[i:i+PRICE_CHUNK]
            try:
                h_bulk = {**HEADERS, "Prefer": "return=minimal"}
                resp = await client.post(f"{REST_URL}/precios", headers=h_bulk, json=chunk)
                if resp.status_code not in (200, 201):
                    print(f"  ⚠ Error batch precios: {resp.status_code} {resp.text[:100]}")
                    errores += len(chunk)
            except Exception as e:
                print(f"  ⚠ Error insertando precios batch: {e}")
                errores += len(chunk)

    if mapeo_hits:
        print(f"  Mapeo validado aplicado: {mapeo_hits} productos linkeados sin IA")
    return {"nuevos": nuevos, "actualizados": actualizados, "errores": errores, "mapeo_hits": mapeo_hits}


async def refrescar_vista(client: httpx.AsyncClient) -> None:
    """Llama al RPC que refresca la vista materializada precios_actuales."""
    try:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/refrescar_precios_actuales",
            headers=HEADERS,
            json={},
        )
        resp.raise_for_status()
        print("  ✓ Vista materializada 'precios_actuales' refrescada")
    except Exception as e:
        print(f"  ⚠ No se pudo refrescar la vista: {e}")
        print("    Ejecuta manualmente en Supabase SQL Editor: SELECT refrescar_precios_actuales();")


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    keys_arg = sys.argv[1:] if len(sys.argv) > 1 else list(TIENDAS_VTEX.keys())
    keys = [k for k in keys_arg if k in TIENDAS_VTEX]
    if not keys:
        print(f"ERROR: supermercados inválidos. Opciones: {list(TIENDAS_VTEX.keys())}")
        sys.exit(1)

    print(f"\n=== PreciosSV VTEX Scraper (REST) — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} ===")
    print(f"Supermercados: {', '.join(keys)}")
    print(f"Supabase: {SUPABASE_URL}\n")

    async with httpx.AsyncClient(follow_redirects=True, timeout=60) as client:
        super_map = await cargar_supermercados(client)
        print(f"Supermercados en BD: {super_map}\n")

        totales = {"nuevos": 0, "actualizados": 0, "errores": 0}

        for key in keys:
            print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] Scrapeando {key}...")
            try:
                productos = await scrape_vtex(key)
                print(f"  -> {len(productos)} productos obtenidos de VTEX")

                if productos:
                    resumen = await guardar_productos(client, productos, super_map)
                    print(f"  -> BD: +{resumen['nuevos']} nuevos, ~{resumen['actualizados']} actualizados, {resumen['errores']} errores")
                    for k in totales:
                        totales[k] += resumen[k]
            except Exception as e:
                print(f"  ERROR en {key}: {e}")

        print(f"\n[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] Refrescando vista materializada…")
        await refrescar_vista(client)

    print(f"\n=== Resumen final ===")
    print(f"  Nuevas variantes:       {totales['nuevos']}")
    print(f"  Precios actualizados:   {totales['actualizados']}")
    print(f"  Errores:                {totales['errores']}")
    print()


if __name__ == "__main__":
    asyncio.run(main())

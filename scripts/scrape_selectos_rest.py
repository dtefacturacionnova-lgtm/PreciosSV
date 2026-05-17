"""
scripts/scrape_selectos_rest.py
Scraper Súper Selectos standalone con Playwright + Supabase REST API.
No requiere PostgreSQL directo ni SQLAlchemy — usa el service role key.

Uso:
  python scripts/scrape_selectos_rest.py

Requiere variables de entorno (o web/.env.local):
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Requiere:
  pip install playwright httpx
  python -m playwright install chromium
"""
import asyncio
import json
import os
import sys
import io
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Optional
import unicodedata
import re

# Forzar stdout a utf-8 en Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
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

import httpx
from playwright.async_api import async_playwright, Response as PlaywrightResponse

REST_URL = f"{SUPABASE_URL}/rest/v1"
HEADERS = {
    "apikey":        SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "return=representation",
}
HEADERS_MIN    = {**HEADERS, "Prefer": "return=minimal"}
HEADERS_UPSERT = {**HEADERS, "Prefer": "resolution=merge-duplicates,return=representation"}

BASE_URL = "https://www.superselectos.com"

CATEGORIAS_SELECTOS = [
    "Abarrotes",
    "Lacteos-y-Huevos",
    "Bebidas",
    "Carnes-y-Mariscos",
    "Frutas-y-Verduras",
    "Limpieza-del-Hogar",
    "Cuidado-Personal",
    "Panaderia-y-Tortilleria",
    "Congelados",
    "Bebes-y-Ninos",
]

SUPERMERCADO_KEY = "selectos"
CHUNK = 200


# ── Helpers ───────────────────────────────────────────────────────────────────

def normalizar_nombre(nombre: str) -> str:
    s = unicodedata.normalize("NFKD", nombre.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _parece_producto(item: dict) -> bool:
    tiene_precio = any(k in item for k in (
        "Price", "precio", "price", "ListPrice", "PriceWithDiscount",
        "priceRange", "spotPrice",
    )) or (
        "items" in item and isinstance(item.get("items"), list) and bool(item["items"])
    )
    tiene_nombre = any(k in item for k in (
        "ProductName", "productName", "nombre", "name", "Name", "Title",
    ))
    return tiene_precio and tiene_nombre


def _parsear_producto(item: dict) -> Optional[dict]:
    try:
        nested_items = item.get("items") or item.get("Items") or []
        sku_nested: dict = (
            nested_items[0]
            if nested_items and isinstance(nested_items, list) and isinstance(nested_items[0], dict)
            else {}
        )

        nombre = (
            item.get("productName") or item.get("ProductName")
            or item.get("Name") or item.get("nombre") or item.get("name")
            or sku_nested.get("nameComplete") or ""
        ).strip()
        if not nombre:
            return None

        sellers_nested = sku_nested.get("sellers") or []
        offer_nested: dict = (
            sellers_nested[0].get("commertialOffer", {})
            if sellers_nested and isinstance(sellers_nested[0], dict)
            else {}
        )

        precio_normal_raw = (
            offer_nested.get("ListPrice") or offer_nested.get("Price")
            or item.get("ListPrice") or item.get("PriceWithoutDiscount")
            or item.get("Price") or item.get("precio") or 0
        )
        precio_normal = Decimal(str(precio_normal_raw))

        precio_oferta_raw = (
            offer_nested.get("Price") if offer_nested.get("Price") and
                Decimal(str(offer_nested.get("Price", 0))) < precio_normal else None
        ) or item.get("PriceWithDiscount") or item.get("SalePrice") or item.get("precioOferta")
        precio_oferta = Decimal(str(precio_oferta_raw)) if precio_oferta_raw else None

        if precio_oferta and precio_oferta >= precio_normal:
            precio_oferta = None
        if precio_normal <= 0:
            return None

        en_oferta = precio_oferta is not None
        descuento_pct = None
        if en_oferta and precio_normal > 0:
            descuento_pct = round(float((precio_normal - precio_oferta) / precio_normal * 100), 2)

        ean = (
            item.get("EAN") or item.get("ean")
            or sku_nested.get("ean") or sku_nested.get("EAN") or None
        )
        if not ean:
            for ref in (sku_nested.get("referenceId") or []):
                if isinstance(ref, dict):
                    k = ref.get("Key", "").upper()
                    if k in ("EAN", "GTIN", "EAN13", "BARCODE"):
                        v = str(ref.get("Value", "")).strip()
                        if v:
                            ean = v
                            break

        sku = str(
            item.get("productId") or item.get("ProductId")
            or item.get("Id") or item.get("id")
            or sku_nested.get("itemId") or ""
        )

        imagenes_nested = sku_nested.get("images") or []
        imagen_url = (
            (imagenes_nested[0].get("imageUrl") if imagenes_nested else None)
            or item.get("ImageUrl") or item.get("imagen") or item.get("image")
        )

        link_text = item.get("linkText") or item.get("LinkText") or item.get("slug") or ""
        url_producto = f"{BASE_URL}/{link_text}/p" if link_text else BASE_URL

        marca = (
            item.get("brand") or item.get("BrandName") or item.get("Brand")
            or item.get("marca") or ""
        ).strip() or None

        disponible = (
            offer_nested.get("IsAvailable", True)
            if offer_nested else item.get("IsAvailable", True)
        )

        cat_raw = item.get("categories") or []
        categoria_nombre = cat_raw[0] if cat_raw else (
            item.get("CategoryName") or item.get("categoria") or None
        )

        return {
            "nombre_local":     nombre,
            "nombre_norm":      normalizar_nombre(nombre),
            "marca":            marca,
            "sku_local":        sku,
            "ean":              ean,
            "precio_normal":    float(precio_normal),
            "precio_oferta":    float(precio_oferta) if precio_oferta else None,
            "en_oferta":        en_oferta,
            "descuento_pct":    descuento_pct,
            "descripcion":      (item.get("Description") or item.get("description") or "").strip() or None,
            "imagen_url":       imagen_url,
            "url_producto":     url_producto,
            "disponible":       disponible,
            "condicion_oferta": item.get("PromotionName") or item.get("condicion") or None,
            "categoria_nombre": categoria_nombre,
        }
    except Exception:
        return None


# ── Playwright scraper ────────────────────────────────────────────────────────

async def scrape_selectos() -> list[dict]:
    productos_raw: list[dict] = []
    urls_vistas: set[str] = set()
    skus_vistos: set[str] = set()

    def manejar_respuesta(response: PlaywrightResponse) -> None:
        url = response.url
        if url in urls_vistas:
            return
        keywords = [
            "producto", "catalog", "search", "item", "sku",
            "graphql", "api/io", "_v/api", "shelf", "productList",
            "intelligentsearch", "product-summary", "productid",
        ]
        if not any(k in url.lower() for k in keywords):
            return
        content_type = response.headers.get("content-type", "")
        if "json" not in content_type:
            return

        async def _consume():
            try:
                data = await response.json()
                urls_vistas.add(url)
                _extraer(data)
            except Exception:
                pass

        asyncio.ensure_future(_consume())

    def _extraer(data) -> None:
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and _parece_producto(item):
                    p = _parsear_producto(item)
                    if p and p["sku_local"] and p["sku_local"] not in skus_vistos:
                        skus_vistos.add(p["sku_local"])
                        productos_raw.append(p)
            return
        if not isinstance(data, dict):
            return
        for clave in ("products", "items", "data", "Products", "Items", "result"):
            if clave in data and isinstance(data[clave], list):
                for item in data[clave]:
                    if isinstance(item, dict) and _parece_producto(item):
                        p = _parsear_producto(item)
                        if p and p["sku_local"] and p["sku_local"] not in skus_vistos:
                            skus_vistos.add(p["sku_local"])
                            productos_raw.append(p)
                return
        if _parece_producto(data):
            p = _parsear_producto(data)
            if p and p["sku_local"] and p["sku_local"] not in skus_vistos:
                skus_vistos.add(p["sku_local"])
                productos_raw.append(p)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
            locale="es-SV",
        )
        page = await context.new_page()
        page.on("response", manejar_respuesta)

        for i, categoria in enumerate(CATEGORIAS_SELECTOS, 1):
            url_cat = f"{BASE_URL}/Tienda/Catalogo/{categoria}"
            print(f"  . [{i}/{len(CATEGORIAS_SELECTOS)}] {categoria} ({len(productos_raw)} productos hasta ahora)")
            try:
                await page.goto(url_cat, wait_until="domcontentloaded", timeout=90_000)
                await asyncio.sleep(5)
                # Scroll completo para activar lazy-loading
                altura_anterior = -1
                while True:
                    altura_actual = await page.evaluate("document.body.scrollHeight")
                    if altura_actual == altura_anterior:
                        break
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await asyncio.sleep(1.5)
                    altura_anterior = altura_actual
                await asyncio.sleep(3)
            except Exception as e:
                print(f"  WARN: Error en categoria {categoria}: {e}")

        await browser.close()

    print(f"  -> {len(productos_raw)} productos unicos obtenidos de Selectos")
    return productos_raw


# ── Supabase helpers ──────────────────────────────────────────────────────────

async def cargar_supermercados(client: httpx.AsyncClient) -> dict[str, int]:
    r = await client.get(f"{REST_URL}/supermercados", params={"select": "id,slug"})
    r.raise_for_status()
    return {row["slug"]: row["id"] for row in r.json()}


async def precargar_variantes(client: httpx.AsyncClient, super_id: int) -> tuple[dict, dict]:
    """Retorna (sku_local -> variante_id, ean_cache -> producto_id)"""
    sku_map: dict[str, int] = {}
    ean_map: dict[str, int] = {}
    offset = 0
    while True:
        r = await client.get(
            f"{REST_URL}/producto_variantes",
            params={
                "select":            "id,sku_local,producto_id,productos(ean)",
                "supermercado_id":   f"eq.{super_id}",
                "limit":             str(CHUNK),
                "offset":            str(offset),
            }
        )
        r.raise_for_status()
        rows = r.json()
        if not rows:
            break
        for row in rows:
            sku_map[row["sku_local"]] = row["id"]
            ean = (row.get("productos") or {}).get("ean")
            if ean and row.get("producto_id"):
                ean_map[ean] = row["producto_id"]
        offset += CHUNK
        if len(rows) < CHUNK:
            break
    return sku_map, ean_map


async def precargar_nombres(client: httpx.AsyncClient) -> dict[str, int]:
    """nombre_norm -> producto_id"""
    nombre_map: dict[str, int] = {}
    offset = 0
    while True:
        r = await client.get(
            f"{REST_URL}/productos",
            params={"select": "id,nombre_normalizado", "limit": str(CHUNK), "offset": str(offset)}
        )
        r.raise_for_status()
        rows = r.json()
        if not rows:
            break
        for row in rows:
            if row.get("nombre_normalizado"):
                nombre_map[row["nombre_normalizado"]] = row["id"]
        offset += CHUNK
        if len(rows) < CHUNK:
            break
    return nombre_map


async def guardar_en_supabase(productos_raw: list[dict], super_id: int, client: httpx.AsyncClient) -> dict:
    print("  -> Pre-cargando cache de variantes y productos existentes...")
    sku_map, ean_map = await precargar_variantes(client, super_id)
    nombre_map = await precargar_nombres(client)

    nuevos       = 0
    actualizados = 0
    errores      = 0
    ahora        = datetime.now(timezone.utc).isoformat()
    precios_batch: list[dict] = []

    for prod in productos_raw:
        try:
            # 1. Resolver producto_id
            producto_id: Optional[int] = None
            ean = prod.get("ean")
            if ean and ean in ean_map:
                producto_id = ean_map[ean]
            if not producto_id:
                nn = prod.get("nombre_norm", "")
                if nn and nn in nombre_map:
                    producto_id = nombre_map[nn]

            # 2. Insertar producto nuevo si no existe
            if not producto_id:
                body = {
                    "nombre":             prod["nombre_local"],
                    "nombre_normalizado": prod["nombre_norm"],
                    "marca":              prod.get("marca"),
                    "ean":                ean,
                    "categoria_id":       None,
                    "imagen_url":         prod.get("imagen_url"),
                }
                r = await client.post(f"{REST_URL}/productos", json=body, headers=HEADERS)
                if r.status_code in (200, 201):
                    rows = r.json()
                    producto_id = rows[0]["id"] if isinstance(rows, list) else rows["id"]
                    nombre_map[prod["nombre_norm"]] = producto_id
                    if ean:
                        ean_map[ean] = producto_id
                    nuevos += 1
                else:
                    errores += 1
                    continue
            else:
                actualizados += 1

            # 3. Upsert variante
            sku = prod.get("sku_local") or f"sel_{prod['nombre_norm'][:40]}"
            var_body = {
                "producto_id":    producto_id,
                "supermercado_id": super_id,
                "sku_local":      sku,
                "nombre_local":   prod["nombre_local"],
                "url_producto":   prod.get("url_producto"),
                "imagen_url":     prod.get("imagen_url"),
                "disponible":     prod.get("disponible", True),
            }
            r = await client.post(
                f"{REST_URL}/producto_variantes",
                json=var_body,
                headers={**HEADERS_UPSERT, "Prefer": "resolution=merge-duplicates,return=representation"},
                params={"on_conflict": "supermercado_id,sku_local"}
            )
            if r.status_code not in (200, 201):
                errores += 1
                continue
            var_rows = r.json()
            variante_id = var_rows[0]["id"] if isinstance(var_rows, list) else var_rows["id"]

            # 4. Acumular precio
            precios_batch.append({
                "variante_id":      variante_id,
                "precio_normal":    prod["precio_normal"],
                "precio_oferta":    prod.get("precio_oferta"),
                "en_oferta":        prod.get("en_oferta", False),
                "descuento_pct":    prod.get("descuento_pct"),
                "condicion_oferta": prod.get("condicion_oferta"),
                "disponible":       prod.get("disponible", True),
                "fecha_hora":       ahora,
            })

        except Exception as e:
            errores += 1
            print(f"  WARN: error procesando producto: {e}")

    # 5. Insertar precios en lotes
    print(f"  -> Insertando {len(precios_batch)} precios en lotes de {CHUNK}...")
    for i in range(0, len(precios_batch), CHUNK):
        chunk = precios_batch[i:i + CHUNK]
        r = await client.post(f"{REST_URL}/precios", json=chunk, headers=HEADERS_MIN)
        if r.status_code not in (200, 201):
            print(f"  WARN: error insertando lote de precios: {r.status_code}")

    return {"nuevos": nuevos, "actualizados": actualizados, "errores": errores}


async def refrescar_vista(client: httpx.AsyncClient) -> None:
    print("  -> Refrescando vista materializada...")
    r = await client.post(f"{SUPABASE_URL}/rest/v1/rpc/refrescar_precios_actuales", json={}, headers=HEADERS)
    if r.status_code in (200, 204):
        print("  -> Vista 'precios_actuales' refrescada")
    else:
        print(f"  WARN: No se pudo refrescar la vista: {r.status_code} {r.text[:100]}")


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    print(f"\n=== PreciosSV Selectos Scraper (Playwright+REST) - {now_utc} ===")
    print(f"Supabase: {SUPABASE_URL}\n")

    async with httpx.AsyncClient(headers=HEADERS, timeout=30) as client:
        supermercados = await cargar_supermercados(client)
        print(f"Supermercados en BD: {supermercados}")

        super_id = supermercados.get(SUPERMERCADO_KEY)
        if not super_id:
            print(f"ERROR: supermercado '{SUPERMERCADO_KEY}' no encontrado en BD")
            sys.exit(1)

        print(f"\n[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] Scrapeando {SUPERMERCADO_KEY}...")
        productos_raw = await scrape_selectos()

        if not productos_raw:
            print("  -> Sin productos obtenidos. Revisar conectividad o estructura del sitio.")
            return

        print(f"\n[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] Guardando en Supabase...")
        resumen = await guardar_en_supabase(productos_raw, super_id, client)

        print(f"  -> BD: +{resumen['nuevos']} nuevos, ~{resumen['actualizados']} actualizados, {resumen['errores']} errores")

        await refrescar_vista(client)

    print(f"\n=== Resumen final ===")
    print(f"  Nuevos:       {resumen['nuevos']}")
    print(f"  Actualizados: {resumen['actualizados']}")
    print(f"  Errores:      {resumen['errores']}")


if __name__ == "__main__":
    asyncio.run(main())

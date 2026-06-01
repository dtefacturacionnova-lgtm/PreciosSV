"""scripts/normalizar_productos.py
Normalización NLP cross-store: detecta y fusiona el mismo producto
scrapeado con distintos nombres en distintos supermercados.

Usa Gemini 1.5 Flash para confirmar si dos productos son idénticos
(misma marca, mismo contenido/peso/volumen).

Uso:
  python scripts/normalizar_productos.py            # aplica cambios
  python scripts/normalizar_productos.py --dry-run  # solo muestra cambios

Requiere en web/.env.local (o variables de entorno):
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  GEMINI_API_KEY
"""
import asyncio
import os
import re
import sys
import argparse
from itertools import combinations
from pathlib import Path

# ── Cargar .env.local ─────────────────────────────────────────────────────────
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
GEMINI_KEY   = os.environ.get("GEMINI_API_KEY", "")

if not SUPABASE_URL or not SERVICE_KEY:
    print("ERROR: Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

if not GEMINI_KEY:
    print("ERROR: Falta GEMINI_API_KEY en web/.env.local o como variable de entorno")
    sys.exit(1)

import httpx

# Usar el nuevo SDK google-genai (reemplaza google-generativeai deprecado)
try:
    from google import genai as genai_new
    gemini_client = genai_new.Client(api_key=GEMINI_KEY)
    GEMINI_MODEL  = "gemini-2.0-flash-lite"   # modelo disponible en tier gratuito
    USE_NEW_SDK   = True
except ImportError:
    import google.generativeai as genai_old
    genai_old.configure(api_key=GEMINI_KEY)
    gemini_client = genai_old.GenerativeModel("gemini-1.5-pro")
    USE_NEW_SDK   = False

REST_URL = f"{SUPABASE_URL}/rest/v1"
HEADERS = {
    "apikey":        SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "return=representation",
}


# ── Helpers de texto ──────────────────────────────────────────────────────────

# Palabras de ruido que NO deben afectar el matching (Capa 2 del doc)
RUIDO = {
    'nuevo', 'nueva', 'especial', 'premium', 'super', 'ultra', 'extra',
    'original', 'clasico', 'classic', 'natural', 'plus', 'max', 'pro',
    'de', 'el', 'la', 'los', 'las', 'con', 'sin', 'para', 'en', 'y',
    'pack', 'paquete', 'unidades', 'unidad', 'und', 'uds',
}

# Sinónimos de unidades (Capa 2 — Normalización de Unidades)
UNIT_ALIASES = {
    'gr': 'g', 'gramos': 'g', 'gramo': 'g',
    'ml': 'ml', 'mililitros': 'ml', 'mililitro': 'ml',
    'lt': 'l', 'lts': 'l', 'litros': 'l', 'litro': 'l',
    'kg': 'kg', 'kgs': 'kg', 'kilogramos': 'kg', 'kilogramo': 'kg',
    'oz': 'oz', 'onzas': 'oz', 'onza': 'oz',
    'lb': 'lb', 'lbs': 'lb', 'libras': 'lb', 'libra': 'lb',
}

# Convertir todo a gramos/ml para comparar cantidades entre empaques
UNIT_TO_BASE = {
    'g': 1, 'kg': 1000, 'lb': 453.6, 'oz': 28.35,
    'ml': 1, 'l': 1000,
}


def normalizar(nombre: str) -> str:
    """Limpieza básica — igual que antes."""
    n = (nombre or '').lower()
    n = re.sub(r'[^a-záéíóúñ0-9 ]', ' ', n)
    n = re.sub(r'\s+', ' ', n).strip()
    return n


def normalizar_unidad(u: str) -> str:
    return UNIT_ALIASES.get(u.lower(), u.lower())


def extraer_atributos(nombre: str, marca: str | None = None) -> dict:
    """
    Capa 2 del documento: extrae atributos estructurados del nombre.
    Retorna: {tokens_limpios, cantidad_base, unidad_base, pack}

    Ejemplos:
      "Jabón Dove Original 3 Pack 270g"  → cantidad_base=90, unidad=g, pack=3
      "JABON DOVE ORIGINAL 90 g"         → cantidad_base=90, unidad=g, pack=1
      "Aceite Borges 500 ml"             → cantidad_base=500, unidad=ml, pack=1
      "Leche LALA 1 L"                   → cantidad_base=1000, unidad=ml, pack=1
    """
    texto = normalizar(nombre)

    # Extraer cantidad total y unidad: "270g", "1.5 l", "500ml"
    m_qty = re.search(r'(\d+[\.,]?\d*)\s*(g|gr|kg|ml|l|lt|lts|litro|litros|oz|lb|lbs)\b', texto)
    cantidad_total = float(m_qty.group(1).replace(',', '.')) if m_qty else None
    unidad = normalizar_unidad(m_qty.group(2)) if m_qty else None

    # Extraer pack: "3 pack", "x3", "3x", "3 unidades", "6pack"
    m_pack = re.search(
        r'(?:^|\s)(\d+)\s*(?:pack|packs|x|unidades?|und\.?|uds\.?)|'
        r'(?:^|\s)(\d+)\s*x\s*\d|'
        r'(\d+)\s*(?:pack)',
        texto
    )
    pack = 1
    if m_pack:
        pack = int(next(g for g in m_pack.groups() if g))

    # Cantidad por unidad base
    cantidad_base = None
    if cantidad_total and unidad:
        factor = UNIT_TO_BASE.get(unidad, 1)
        cantidad_base = round(cantidad_total * factor / pack, 2)
        # Normalizar ml→l si > 1000
        if unidad == 'ml' and cantidad_base >= 1000:
            cantidad_base /= 1000
            unidad = 'l'

    # Tokens limpios: quitar ruido, cantidades y unidades ya extraídas
    tokens = [t for t in texto.split()
              if t not in RUIDO
              and not re.match(r'^\d+[\.,]?\d*$', t)
              and t not in UNIT_ALIASES
              and t not in UNIT_TO_BASE]

    # Quitar nombre de marca de los tokens si la conocemos
    if marca:
        marca_norm = normalizar(marca).split()
        tokens = [t for t in tokens if t not in marca_norm]

    return {
        'tokens':         tokens,
        'cantidad_base':  cantidad_base,
        'unidad_base':    unidad,
        'pack':           pack,
    }


def similitud_estructurada(a: dict, b: dict, attr_a: dict, attr_b: dict) -> float:
    """
    Capa 2 mejorada: combina similitud de tokens con comparación de atributos.

    Penaliza fuertemente si la cantidad base difiere (distinta presentación).
    Bonifica si marca y tipo coinciden.
    """
    # Score base: Jaccard sobre tokens limpios
    ta, tb = set(attr_a['tokens']), set(attr_b['tokens'])
    jac = len(ta & tb) / len(ta | tb) if (ta | tb) else 0.0

    # Comparar cantidades base
    ca, cb = attr_a['cantidad_base'], attr_b['cantidad_base']
    ua, ub = attr_a['unidad_base'], attr_b['unidad_base']

    qty_score = 0.0
    if ca and cb and ua and ub:
        if ua == ub:
            ratio = min(ca, cb) / max(ca, cb) if max(ca, cb) > 0 else 1.0
            qty_score = ratio  # 1.0 si iguales, <1 si difieren
        # Si unidades incompatibles (g vs ml) → penalizar
    elif not ca and not cb:
        qty_score = 0.5  # ambos sin cantidad → neutral

    # Score combinado: 60% tokens + 40% cantidad
    return 0.60 * jac + 0.40 * qty_score


def jaccard(a: str, b: str) -> float:
    """Jaccard clásico sobre tokens — mantenido para compatibilidad."""
    wa, wb = set(a.split()), set(b.split())
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


# ── REST helpers ──────────────────────────────────────────────────────────────

async def rest_get(client: httpx.AsyncClient, table: str, params: dict) -> list[dict]:
    resp = await client.get(f"{REST_URL}/{table}", headers=HEADERS, params=params)
    resp.raise_for_status()
    return resp.json()


async def rest_patch(client: httpx.AsyncClient, table: str, filtro: dict, body: dict) -> bool:
    h = {**HEADERS, "Prefer": "return=minimal"}
    resp = await client.patch(f"{REST_URL}/{table}", headers=h, params=filtro, json=body)
    return resp.status_code < 300


async def rest_delete(client: httpx.AsyncClient, table: str, filtro: dict) -> bool:
    h = {**HEADERS, "Prefer": "return=minimal"}
    resp = await client.delete(f"{REST_URL}/{table}", headers=h, params=filtro)
    return resp.status_code < 300


# ── Fase 1: cargar candidatos ─────────────────────────────────────────────────

SELECTOS_ID = 1  # supermercado_id de Súper Selectos

async def cargar_candidatos(client: httpx.AsyncClient) -> list[dict]:
    """
    Carga DOS grupos de productos y los combina:

    Grupo A — Productos Selectos sin EAN (solo aparecen en Selectos):
        Creados por el scraper de Selectos sin poder matchear por EAN.
        Son candidatos a ser fusionados con su equivalente VTEX.

    Grupo B — Productos VTEX con EAN (Walmart / Don Juan / Maxi):
        Productos canónicos que YA tienen EAN. Se usan como destino del match.

    El normalizador busca pares (A_i, B_j) con nombres similares y los
    envía a Gemini. Si confirma que son el mismo producto, la variante
    de Selectos se reasigna al producto VTEX y el duplicado se elimina.
    """
    CHUNK = 400

    # ── Grupo A: productos de Selectos sin EAN ──────────────────────────────
    # Primero, variantes activas de Selectos → sus producto_ids
    sel_variantes = await rest_get(client, "producto_variantes", {
        "select":          "producto_id",
        "supermercado_id": f"eq.{SELECTOS_ID}",
        "activo":          "eq.true",
        "limit":           "15000",
    })
    sel_prod_ids = list({v["producto_id"] for v in sel_variantes})
    print(f"      Variantes Selectos: {len(sel_prod_ids)} productos únicos")

    # Cargar esos productos que además NO tienen EAN
    grupo_a: list[dict] = []
    for i in range(0, len(sel_prod_ids), CHUNK):
        chunk = [str(x) for x in sel_prod_ids[i:i + CHUNK]]
        rows = await rest_get(client, "productos", {
            "select": "id,nombre,marca,ean",
            "id":     f"in.({','.join(chunk)})",
            "ean":    "is.null",
            "activo": "eq.true",
        })
        grupo_a.extend(rows)
    print(f"      Grupo A (Selectos sin EAN): {len(grupo_a)} productos")

    # ── Grupo B: productos VTEX con EAN ──────────────────────────────────────
    # Variantes de Walmart/Don Juan/Maxi → sus producto_ids
    vtex_variantes = await rest_get(client, "producto_variantes", {
        "select":          "producto_id",
        "supermercado_id": f"in.(2,3,4)",
        "activo":          "eq.true",
        "limit":           "15000",
    })
    vtex_prod_ids = list({v["producto_id"] for v in vtex_variantes})

    grupo_b: list[dict] = []
    for i in range(0, len(vtex_prod_ids), CHUNK):
        chunk = [str(x) for x in vtex_prod_ids[i:i + CHUNK]]
        rows = await rest_get(client, "productos", {
            "select": "id,nombre,marca,ean",
            "id":     f"in.({','.join(chunk)})",
            "activo": "eq.true",
        })
        grupo_b.extend(rows)
    print(f"      Grupo B (VTEX con/sin EAN): {len(grupo_b)} productos")

    # ── Asignar supermercados a cada producto ─────────────────────────────────
    todos_ids = [str(p["id"]) for p in grupo_a + grupo_b]
    super_por_prod: dict[int, set[int]] = {}
    for i in range(0, len(todos_ids), CHUNK):
        chunk = todos_ids[i:i + CHUNK]
        variantes = await rest_get(client, "producto_variantes", {
            "select":      "producto_id,supermercado_id",
            "producto_id": f"in.({','.join(chunk)})",
            "activo":      "eq.true",
        })
        for v in variantes:
            pid = v["producto_id"]
            super_por_prod.setdefault(pid, set()).add(v["supermercado_id"])

    for p in grupo_a + grupo_b:
        p["supermercados"] = list(super_por_prod.get(p["id"], set()))
        p["_grupo"] = "A" if p in grupo_a else "B"

    # Marcar correctamente el grupo después de iterar
    ids_a = {p["id"] for p in grupo_a}
    for p in grupo_a + grupo_b:
        p["_grupo"] = "A" if p["id"] in ids_a else "B"

    # Retornar solo grupos con supermercados asignados
    return [p for p in grupo_a + grupo_b if p["supermercados"]]


# ── Fase 2: pre-filtro por similitud ─────────────────────────────────────────

def encontrar_pares(productos: list[dict]) -> list[tuple[dict, dict]]:
    """
    Capa 2 mejorada: matching estructurado Selectos × VTEX.

    Aplica la estrategia del documento de investigación:
    - Normalización de unidades ('gr'='g', 'lt'='l')
    - Extracción de pack ('3 Pack 270g' → 1 unidad de 90g)
    - Eliminación de ruido ('nuevo', 'especial', 'pack', etc.)
    - Similitud combinada: 60% tokens limpios + 40% cantidad base
    - Umbral: score >= 0.40 (más preciso que Jaccard simple)
    """
    grupo_a = [p for p in productos if p.get("_grupo") == "A"]
    grupo_b = [p for p in productos if p.get("_grupo") == "B"]
    print(f"      Cruzando {len(grupo_a)} Selectos x {len(grupo_b)} VTEX...")

    # Pre-calcular atributos estructurados
    attrs_a = {p["id"]: extraer_atributos(p["nombre"] or "", p.get("marca")) for p in grupo_a}
    attrs_b = {p["id"]: extraer_atributos(p["nombre"] or "", p.get("marca")) for p in grupo_b}

    pares_scored: list[tuple[float, dict, dict]] = []

    for a in grupo_a:
        sa = set(a["supermercados"])
        if not sa:
            continue
        attr_a = attrs_a[a["id"]]
        tokens_a = attr_a["tokens"]
        if not tokens_a:
            continue
        first_a = tokens_a[0]

        for b in grupo_b:
            sb = set(b["supermercados"])
            if not sb or (sa & sb):
                continue  # mismo supermercado → producto distinto

            # Misma marca (si ambos la tienen)
            if a.get("marca") and b.get("marca"):
                if normalizar(a["marca"]) != normalizar(b["marca"]):
                    continue

            attr_b = attrs_b[b["id"]]
            tokens_b = attr_b["tokens"]
            if not tokens_b:
                continue

            # Filtro rápido: primera palabra del tipo de producto debe coincidir
            if first_a != tokens_b[0]:
                continue

            sim = similitud_estructurada(a, b, attr_a, attr_b)
            if sim >= 0.40:
                pares_scored.append((sim, a, b))

    pares_scored.sort(key=lambda x: -x[0])
    top = pares_scored[:500]

    # Log de cantidad base para diagnóstico
    qty_matches = sum(1 for s, a, b in top
                      if attrs_a[a["id"]]["cantidad_base"] and attrs_b[b["id"]]["cantidad_base"]
                      and abs(attrs_a[a["id"]]["cantidad_base"] - attrs_b[b["id"]]["cantidad_base"]) < 1)
    print(f"      De {len(top)} pares: {qty_matches} con cantidad base idéntica")

    return [(a, b) for _, a, b in top]


# ── Fase 3: confirmación con Gemini ──────────────────────────────────────────

async def confirmar_con_gemini(pares: list[tuple[dict, dict]]) -> list[tuple[dict, dict]]:
    """Batches de 20 pares → Gemini confirma SI/NO."""
    confirmados: list[tuple[dict, dict]] = []
    BATCH = 20
    total_batches = (len(pares) + BATCH - 1) // BATCH

    for batch_num in range(total_batches):
        batch = pares[batch_num * BATCH:(batch_num + 1) * BATCH]
        lineas = []
        for j, (a, b) in enumerate(batch, 1):
            ma = f" ({a['marca']})" if a.get("marca") else ""
            mb = f" ({b['marca']})" if b.get("marca") else ""
            lineas.append(f"{j}. \"{a['nombre']}{ma}\" vs \"{b['nombre']}{mb}\"")

        prompt = (
            "Eres un experto en productos de supermercado de El Salvador.\n"
            "Para cada par, determina si son EXACTAMENTE el mismo producto "
            "(misma marca, mismo contenido/peso/volumen, no variantes diferentes).\n"
            "Responde SOLO con una línea por par: número, espacio, SI o NO.\n"
            "Ejemplo de respuesta:\n1 SI\n2 NO\n3 SI\n\n"
            + "\n".join(lineas)
        )

        try:
            loop = asyncio.get_event_loop()
            if USE_NEW_SDK:
                resp = await loop.run_in_executor(
                    None,
                    lambda p=prompt: gemini_client.models.generate_content(
                        model=GEMINI_MODEL, contents=p
                    )
                )
                texto = resp.text
            else:
                resp = await loop.run_in_executor(
                    None, lambda p=prompt: gemini_client.generate_content(p)
                )
                texto = resp.text

            si_count = 0
            for line in texto.strip().splitlines():
                parts = line.strip().split()
                if len(parts) >= 2:
                    try:
                        idx = int(parts[0]) - 1
                        if 0 <= idx < len(batch) and parts[1].upper() == "SI":
                            confirmados.append(batch[idx])
                            si_count += 1
                    except ValueError:
                        pass
            print(f"  Batch {batch_num + 1}/{total_batches}: {si_count} confirmados")
        except Exception as e:
            print(f"  WARN batch {batch_num + 1}: {e}")

        await asyncio.sleep(0.5)

    return confirmados


# ── Fase 4: fusión ────────────────────────────────────────────────────────────

async def fusionar(client: httpx.AsyncClient, a: dict, b: dict, dry_run: bool) -> bool:
    """
    Mantiene el producto con ID menor (canónico).
    Reasigna variantes y referencias, luego elimina el duplicado.
    Omite la fusión si alguno de los productos está en proveedor_catalogo
    (para no romper catálogos de proveedores ya configurados).
    """
    canonical_id  = min(a["id"], b["id"])
    duplicate_id  = max(a["id"], b["id"])
    canonical_nom = a["nombre"] if a["id"] == canonical_id else b["nombre"]
    duplicate_nom = a["nombre"] if a["id"] == duplicate_id else b["nombre"]

    # Verificar que el duplicado no esté en ningún catálogo de proveedor
    catalogo_refs = await rest_get(client, "proveedor_catalogo", {
        "select":      "id",
        "producto_id": f"eq.{duplicate_id}",
        "limit":       "1",
    })
    if catalogo_refs:
        print(f"  SKIP #{duplicate_id}: referenciado en proveedor_catalogo")
        return False

    print(f"  {'[dry-run] ' if dry_run else ''}Fusionando:")
    print(f"    Canónico  → #{canonical_id}: {canonical_nom}")
    print(f"    Duplicado → #{duplicate_id}: {duplicate_nom}")

    if dry_run:
        return True

    # 1. Reasignar variantes
    ok = await rest_patch(client, "producto_variantes",
                          {"producto_id": f"eq.{duplicate_id}"},
                          {"producto_id": canonical_id})
    if not ok:
        print(f"    ✗ Error al reasignar variantes")
        return False

    # 2. Reasignar competidores de catálogo
    await rest_patch(client, "proveedor_competidores_catalogo",
                     {"competidor_producto_id": f"eq.{duplicate_id}"},
                     {"competidor_producto_id": canonical_id})

    # 3. Eliminar duplicado
    ok = await rest_delete(client, "productos", {"id": f"eq.{duplicate_id}"})
    if not ok:
        print(f"    ✗ Error al eliminar duplicado")
        return False

    print(f"    ✓ OK")
    return True


# ── Main ──────────────────────────────────────────────────────────────────────

async def main(dry_run: bool) -> None:
    print("=" * 50)
    print("Normalización NLP cross-store — PreciosSV")
    print(f"Modo: {'dry-run (sin cambios en BD)' if dry_run else 'REAL'}")
    print("=" * 50)

    async with httpx.AsyncClient(timeout=30) as client:

        print("\n[1/4] Cargando productos sin EAN...")
        productos = await cargar_candidatos(client)
        print(f"      {len(productos)} productos sin EAN")

        if len(productos) < 2:
            print("      Sin candidatos suficientes. Fin.")
            return

        print("\n[2/4] Pre-filtrando pares similares (Jaccard >= 0.35)...")
        pares = encontrar_pares(productos)
        print(f"      {len(pares)} pares candidatos")

        if not pares:
            print("      Sin pares candidatos. Fin.")
            return

        # Mostrar los pares encontrados para revisión
        print("\n  Pares candidatos encontrados:")
        for i, (a, b) in enumerate(pares, 1):
            attr_a = extraer_atributos(a["nombre"] or "", a.get("marca"))
            attr_b = extraer_atributos(b["nombre"] or "", b.get("marca"))
            sim = similitud_estructurada(a, b, attr_a, attr_b)
            ca = f"{attr_a['cantidad_base']}{attr_a['unidad_base']}" if attr_a['cantidad_base'] else "?"
            cb = f"{attr_b['cantidad_base']}{attr_b['unidad_base']}" if attr_b['cantidad_base'] else "?"
            print(f"  {i:2d}. [sim={sim:.2f}] Selectos id={a['id']} ({ca}/und) | VTEX id={b['id']} ({cb}/und)")
            print(f"        A: \"{a['nombre']}\"")
            print(f"        B: \"{b['nombre']}\"")

        print(f"\n[3/4] Confirmando con Gemini ({len(pares)} pares)...")
        confirmados = await confirmar_con_gemini(pares)
        print(f"      {len(confirmados)} duplicados confirmados")

        if not confirmados:
            print("      Sin duplicados. Fin.")
            return

        print(f"\n[4/4] Fusionando {len(confirmados)} pares...")
        fusionados = 0
        for a, b in confirmados:
            if await fusionar(client, a, b, dry_run):
                fusionados += 1

        print(f"\nResultado: {fusionados}/{len(confirmados)} fusiones {'simuladas' if dry_run else 'aplicadas'}")

        if not dry_run and fusionados > 0:
            resp = await client.post(
                f"{SUPABASE_URL}/rest/v1/rpc/refrescar_precios_actuales",
                headers=HEADERS,
                json={},
            )
            if resp.status_code < 300:
                print("Vista materializada refrescada OK")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Normalización NLP cross-store")
    parser.add_argument("--dry-run", action="store_true",
                        help="Mostrar cambios sin aplicarlos a la BD")
    args = parser.parse_args()
    asyncio.run(main(args.dry_run))

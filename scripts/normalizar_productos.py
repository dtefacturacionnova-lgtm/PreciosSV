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
import google.generativeai as genai  # pip install google-generativeai

REST_URL = f"{SUPABASE_URL}/rest/v1"
HEADERS = {
    "apikey":        SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "return=representation",
}

genai.configure(api_key=GEMINI_KEY)
gemini = genai.GenerativeModel("gemini-1.5-flash-latest")


# ── Helpers de texto ──────────────────────────────────────────────────────────

def normalizar(nombre: str) -> str:
    n = nombre.lower()
    n = re.sub(r'[^a-záéíóúñ0-9 ]', ' ', n)
    n = re.sub(r'\s+', ' ', n).strip()
    return n


def jaccard(a: str, b: str) -> float:
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

async def cargar_candidatos(client: httpx.AsyncClient) -> list[dict]:
    """Productos sin EAN con su lista de supermercados donde aparecen."""
    productos = await rest_get(client, "productos", {
        "select":  "id,nombre,marca",
        "ean":     "is.null",
        "activo":  "eq.true",
        "order":   "id.asc",
        "limit":   "2000",
    })
    if not productos:
        return []

    ids = [str(p["id"]) for p in productos]
    CHUNK = 400
    super_por_prod: dict[int, set[int]] = {}

    for i in range(0, len(ids), CHUNK):
        chunk = ids[i:i + CHUNK]
        variantes = await rest_get(client, "producto_variantes", {
            "select":       "producto_id,supermercado_id",
            "producto_id":  f"in.({','.join(chunk)})",
            "activo":       "eq.true",
        })
        for v in variantes:
            pid = v["producto_id"]
            super_por_prod.setdefault(pid, set()).add(v["supermercado_id"])

    for p in productos:
        p["supermercados"] = list(super_por_prod.get(p["id"], set()))
    return productos


# ── Fase 2: pre-filtro por similitud ─────────────────────────────────────────

def encontrar_pares(productos: list[dict]) -> list[tuple[dict, dict]]:
    """
    Devuelve pares candidatos con Jaccard >= 0.35 que están en supermercados
    diferentes (compartir supermercado descarta el merge).
    Límite de 500 pares para no sobrecargar Gemini.
    """
    pares_scored: list[tuple[float, dict, dict]] = []

    for a, b in combinations(productos, 2):
        sa, sb = set(a["supermercados"]), set(b["supermercados"])
        if not sa or not sb:
            continue
        if sa & sb:
            continue  # mismo supermercado → son distintos productos

        na = normalizar(a["nombre"])
        nb = normalizar(b["nombre"])
        pa = na.split()
        pb = nb.split()

        if not pa or not pb or pa[0] != pb[0]:
            continue  # primera palabra distinta → descartado

        # Misma marca si ambos tienen marca
        if a.get("marca") and b.get("marca"):
            if normalizar(a["marca"]) != normalizar(b["marca"]):
                continue

        sim = jaccard(na, nb)
        if sim >= 0.35:
            pares_scored.append((sim, a, b))

    pares_scored.sort(key=lambda x: -x[0])
    return [(a, b) for _, a, b in pares_scored[:500]]


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
            resp = await loop.run_in_executor(
                None, lambda p=prompt: gemini.generate_content(p)
            )
            for line in resp.text.strip().splitlines():
                parts = line.strip().split()
                if len(parts) >= 2:
                    try:
                        idx = int(parts[0]) - 1
                        if 0 <= idx < len(batch) and parts[1].upper() == "SI":
                            confirmados.append(batch[idx])
                    except ValueError:
                        pass
            print(f"  Batch {batch_num + 1}/{total_batches}: {sum(1 for l in resp.text.splitlines() if 'SI' in l.upper())} confirmados")
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

        print("\n[2/4] Pre-filtrando pares similares (Jaccard ≥ 0.35)...")
        pares = encontrar_pares(productos)
        print(f"      {len(pares)} pares candidatos")

        if not pares:
            print("      Sin pares candidatos. Fin.")
            return

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

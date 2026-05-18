"""
scripts/scrape_selectos_rest.py
Scraper Súper Selectos standalone con Playwright + Supabase REST API.
No requiere PostgreSQL directo ni SQLAlchemy — usa el service role key.

Uso:
  python scripts/scrape_selectos_rest.py

Requiere variables de entorno (o web/.env.local):
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  SELECTOS_EMAIL      (opcional — para autenticación y catálogo completo)
  SELECTOS_PASSWORD   (opcional)

Requiere:
  pip install playwright httpx
  python -m playwright install chromium

Estrategia:
  El sitio usa Blazor Server (binario SignalR) — no hay REST API pública.
  Se usa Playwright para navegar via Blazor.navigateTo('/products?category=XXXX')
  y extraer productos del DOM renderizado (.producto-box).
  Un crawler recorre el árbol de categorías descubriendo sub-categorías.
"""
import asyncio
import os
import sys
import io
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation
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

SUPABASE_URL      = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
SERVICE_KEY       = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SELECTOS_EMAIL    = os.environ.get("SELECTOS_EMAIL", "")
SELECTOS_PASSWORD = os.environ.get("SELECTOS_PASSWORD", "")

if not SUPABASE_URL or not SERVICE_KEY:
    print("ERROR: Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

import httpx
from playwright.async_api import async_playwright

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
SUPERMERCADO_KEY = "selectos"
CHUNK = 200

# ── Categorías raíz confirmadas vía URL superselectos.com/products?category=XXX ─
# Códigos obtenidos navegando cada sección del menú de Selectos (2026-05-18)
CATEGORIAS_RAIZ = [
    # Productos frescos (Carnes, Lácteos, Frutas, Embutidos, Mariscos, Panadería…)
    "011", "012", "013", "014", "015", "016", "017", "018", "019",
    # Productos congelados
    "021",
    # Abarrotes
    "031", "032", "033", "035", "036", "037",
    "0310", "0311", "0313", "0315", "0316", "0317", "0318", "0324",
    # Cervezas, vinos y licores
    "041", "042", "043", "044", "045",
    # Bebidas
    "051", "052", "053", "054", "055", "056", "057", "058", "059", "0510",
    # Cuidado mascotas
    "061", "062", "063",
    # Cuidado del hogar
    "071", "072", "073", "074", "075", "076", "077",
    # Cuidado personal
    "081", "082", "083", "084", "085", "086", "087", "088", "089",
    "0810", "0811",
    # Cuidado del bebé
    "091", "092", "093", "094", "095",
    # Mercancías generales (ropa, juguetes, ferretería — se scrapea pero sin cat BD)
    "101",
    # Sub-categorías confirmadas vía URL (descubiertas en crawls anteriores)
    "03695",    # sub de Abarrotes
    "01634",    # sub de Productos frescos
    "042159",   # sub de Cervezas/Licores
    "081235",   # Jabones de tocador → Cuidado Personal
]

# ── Mapeo código Selectos → ID de categoría en BD ────────────────────────────
# DB: Lácteos=1, Carnes=2, Frutas=3, Abarrotes=4, Bebidas=5,
#     Limpieza=6, Cuidado Personal=7, Panadería=8, Congelados=9, Mascotas=10
# Productos frescos → None (mezcla de categorías; los productos heredan null
#   hasta que se mapeen sub-categorías individualmente)
SELECTOS_CAT_MAP: dict[str, int | None] = {
    # ── Productos frescos (mixto — sin categoría única en BD) ──────────
    "011": None, "012": None, "013": None, "014": None, "015": None,
    "016": None, "017": None, "018": None, "019": None,
    "01634": None,
    # ── Productos congelados ───────────────────────────────────────────
    "021": 9,
    # ── Abarrotes ──────────────────────────────────────────────────────
    "031": 4, "032": 4, "033": 4, "035": 4, "036": 4, "037": 4,
    "0310": 4, "0311": 4, "0313": 4, "0315": 4, "0316": 4,
    "0317": 4, "0318": 4, "0324": 4, "03695": 4,
    # ── Cervezas, vinos y licores → Bebidas ───────────────────────────
    "041": 5, "042": 5, "043": 5, "044": 5, "045": 5, "042159": 5,
    # ── Bebidas ────────────────────────────────────────────────────────
    "051": 5, "052": 5, "053": 5, "054": 5, "055": 5,
    "056": 5, "057": 5, "058": 5, "059": 5, "0510": 5,
    # ── Cuidado mascotas ───────────────────────────────────────────────
    "061": 10, "062": 10, "063": 10,
    # ── Cuidado del hogar → Limpieza ───────────────────────────────────
    "071": 6, "072": 6, "073": 6, "074": 6, "075": 6, "076": 6, "077": 6,
    # ── Cuidado personal ───────────────────────────────────────────────
    "081": 7, "082": 7, "083": 7, "084": 7, "085": 7,
    "086": 7, "087": 7, "088": 7, "089": 7, "0810": 7, "0811": 7,
    "081235": 7,
    # ── Cuidado del bebé (sin cat BD aún) ─────────────────────────────
    "091": None, "092": None, "093": None, "094": None, "095": None,
    # ── Mercancías generales (fuera del scope de comparador) ───────────
    "101": None,
}


def _inferir_cat_bd(cat_code: str) -> int | None:
    """Devuelve el ID de categoría BD para un código de categoría Selectos.
    Primero busca coincidencia exacta; si no, infiere por prefijo de 2-3 dígitos
    para cubrir sub-categorías descubiertas dinámicamente en el BFS."""
    if cat_code in SELECTOS_CAT_MAP:
        return SELECTOS_CAT_MAP[cat_code]
    # Fallback: prefijo de 3 → 2 dígitos
    for n in (3, 2):
        prefix = cat_code[:n]
        if prefix in SELECTOS_CAT_MAP:
            return SELECTOS_CAT_MAP[prefix]
    return None


# ── Helpers de texto ──────────────────────────────────────────────────────────

def normalizar_nombre(nombre: str) -> str:
    s = unicodedata.normalize("NFKD", nombre.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# ── JavaScript para extraer productos del DOM ─────────────────────────────────

JS_EXTRAER_PRODUCTOS = """
() => {
    const boxes = document.querySelectorAll('.producto-box');
    return Array.from(boxes).map(box => {
        const linkEl = box.querySelector('h5.prod-nombre a') || box.querySelector('a.clickeable');
        const nombre = linkEl ? linkEl.innerText.trim() : '';
        const href   = linkEl ? (linkEl.getAttribute('href') || '') : '';

        const m = href.match(/productId=([\\d]+)/);
        const productId = m ? m[1] : '';

        const precioEl    = box.querySelector('strong.precio');
        const ofertaEl    = box.querySelector('.precio-oferta, .precio-tachado, .precio-anterior');
        const precio_raw  = precioEl ? precioEl.innerText.replace(/[^0-9.]/g,'').trim() : '';
        const oferta_raw  = ofertaEl ? ofertaEl.innerText.replace(/[^0-9.]/g,'').trim() : '';

        const imgEl     = box.querySelector('img');
        const imagenUrl = imgEl ? imgEl.src : '';

        const enOferta = box.querySelector('[class*="oferta"],[class*="descuento"]') !== null;

        const catLinks = Array.from(box.closest('body').querySelectorAll('a[href*="category="]'))
                         .map(a => a.getAttribute('href'))
                         .filter(h => h && h.includes('category='));

        return {nombre, productId, precio_raw, oferta_raw, imagenUrl, href, enOferta, catLinks};
    }).filter(p => p.nombre && p.productId && p.precio_raw);
}
"""

JS_EXTRAER_CAT_LINKS = """
() => {
    return Array.from(document.querySelectorAll('a[href*="category="]'))
           .map(a => a.getAttribute('href'))
           .filter((h, i, arr) => h && arr.indexOf(h) === i)
           .map(h => {
               const m = h.match(/category=([\\w]+)/);
               return m ? m[1] : null;
           })
           .filter(Boolean);
}
"""


def _parsear(raw: dict) -> Optional[dict]:
    try:
        nombre = raw["nombre"].strip()
        if not nombre:
            return None
        precio_normal = Decimal(raw["precio_raw"])
        if precio_normal <= 0:
            return None
        precio_oferta = None
        if raw.get("oferta_raw"):
            try:
                v = Decimal(raw["oferta_raw"])
                if 0 < v < precio_normal:
                    precio_oferta = v
            except InvalidOperation:
                pass
        en_oferta = precio_oferta is not None or raw.get("enOferta", False)
        descuento_pct = None
        if precio_oferta:
            descuento_pct = round(float((precio_normal - precio_oferta) / precio_normal * 100), 2)

        url = raw.get("href", "")
        if not url.startswith("http"):
            url = BASE_URL + ("" if url.startswith("/") else "/") + url

        return {
            "nombre_local":  nombre,
            "nombre_norm":   normalizar_nombre(nombre),
            "marca":         None,
            "sku_local":     raw["productId"],
            "ean":           None,
            "precio_normal": float(precio_normal),
            "precio_oferta": float(precio_oferta) if precio_oferta else None,
            "en_oferta":     en_oferta,
            "descuento_pct": descuento_pct,
            "descripcion":   None,
            "imagen_url":    raw.get("imagenUrl") or None,
            "url_producto":  url or BASE_URL,
            "condicion_oferta": None,
        }
    except (InvalidOperation, Exception):
        return None


# ── Login Selectos ────────────────────────────────────────────────────────────

async def _login(page) -> bool:
    """
    Autentica en Selectos via Playwright usando SELECTOS_EMAIL / SELECTOS_PASSWORD.
    Retorna True si el login fue exitoso.

    Notas sobre el sitio:
    - Selectos usa Radzen Blazor: el input de email se renderiza como type='text', no type='email'
    - El botón de submit dice exactamente "Iniciar Sesión" (no "Ingresar" ni "Entrar")
    - Se localiza el email buscando el input text visible justo antes del campo de contraseña en el DOM
    """
    try:
        print(f"  . Haciendo login como {SELECTOS_EMAIL}...")
        await page.evaluate("Blazor.navigateTo('/login')")

        # Esperar a que el formulario esté visible (el campo de contraseña es el indicador más fiable)
        pass_input = None
        for _ in range(15):
            await asyncio.sleep(1)
            el = await page.query_selector("input[type='password']")
            if el and await el.is_visible():
                pass_input = el
                break

        if not pass_input:
            print("  WARN: No se encontró campo de contraseña en /login")
            return False

        # Radzen renderiza el campo email como type='text'.
        # Buscar el input de texto visible inmediatamente anterior al password en el DOM.
        email_handle = await page.evaluate_handle("""() => {
            const passInput = document.querySelector("input[type='password']");
            if (!passInput) return null;
            const allInputs = Array.from(document.querySelectorAll("input"));
            const passIdx   = allInputs.indexOf(passInput);
            for (let i = passIdx - 1; i >= 0; i--) {
                const inp = allInputs[i];
                if ((inp.type === 'text' || inp.type === 'email') && inp.offsetParent !== null) {
                    return inp;
                }
            }
            return null;
        }""")
        email_input = email_handle.as_element()

        if not email_input:
            print("  WARN: No se encontró campo de email")
            return False

        await email_input.fill(SELECTOS_EMAIL)
        await asyncio.sleep(0.5)
        await pass_input.fill(SELECTOS_PASSWORD)
        await asyncio.sleep(0.5)

        # Botón submit — texto confirmado via DOM inspection: "Iniciar Sesión"
        submit = await page.query_selector(
            "button[type='submit'], button:has-text('Iniciar Sesión')"
        )
        if submit:
            await submit.click()
        else:
            await pass_input.press("Enter")

        await asyncio.sleep(8)

        # Verificar login exitoso
        logged_in = await page.evaluate("""() => {
            const t = document.body.innerText || '';
            return t.includes('Mis productos') || t.includes('Cerrar sesión') ||
                   t.includes('Cerrar Sesión') || t.includes('Mi cuenta') ||
                   document.querySelector('a[href*="/favorites"]') !== null;
        }""")

        if logged_in:
            print("  . Login exitoso")
            await page.evaluate("Blazor.navigateTo('/')")
            await asyncio.sleep(5)
            return True
        else:
            print(f"  WARN: Login no confirmado (url={page.url}) — continuando sin sesión")
            return False

    except Exception as e:
        print(f"  WARN: Error en login: {e}")
        return False


# ── Playwright crawler ────────────────────────────────────────────────────────

async def scrape_selectos() -> list[dict]:
    productos_raw: list[dict] = []
    skus_vistos:   set[str]   = set()
    cats_visitadas: set[str]  = set()
    cats_pendientes: list[str] = list(CATEGORIAS_RAIZ)
    # cat_root_map: cada cat_id → código raíz del que desciende (para heredar categoría BD)
    cat_root_map: dict[str, str] = {cat: cat for cat in CATEGORIAS_RAIZ}

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
            viewport={"width": 1920, "height": 1080},
            locale="es-SV",
        )
        page = await context.new_page()

        # Inicializar Blazor en la home
        print("  . Inicializando Blazor...")
        await page.goto(f"{BASE_URL}/", wait_until="load", timeout=90_000)
        await asyncio.sleep(10)

        # Login opcional — activa catálogo completo autenticado
        if SELECTOS_EMAIL and SELECTOS_PASSWORD:
            await _login(page)
        else:
            print("  . Sin credenciales — crawl en modo publico")

        while cats_pendientes:
            cat_id = cats_pendientes.pop(0)
            if cat_id in cats_visitadas:
                continue
            cats_visitadas.add(cat_id)

            url_cat = f"/products?category={cat_id}"
            try:
                await page.evaluate(f"Blazor.navigateTo('{url_cat}')")
                # Esperar a que los productos aparezcan
                await asyncio.sleep(3)
                for _ in range(20):
                    n = await page.evaluate("() => document.querySelectorAll('.producto-box').length")
                    nombres_ok = await page.evaluate(
                        "() => document.querySelectorAll('.producto-box h5.prod-nombre a').length"
                    )
                    if nombres_ok > 0:
                        break
                    await asyncio.sleep(1.5)
                await asyncio.sleep(2)

                # Scroll para cargar más
                prev_count = -1
                for _ in range(15):
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await asyncio.sleep(1.5)
                    curr = await page.evaluate("() => document.querySelectorAll('.producto-box').length")
                    if curr == prev_count:
                        break
                    prev_count = curr

                # Extraer productos
                raws = await page.evaluate(JS_EXTRAER_PRODUCTOS)
                nuevos = 0
                # Determinar categoría BD para los productos de esta página
                root_code = cat_root_map.get(cat_id, cat_id)
                cat_bd_id = _inferir_cat_bd(root_code)
                for raw in raws:
                    pid = raw.get("productId", "")
                    if pid and pid not in skus_vistos:
                        p = _parsear(raw)
                        if p:
                            p["categoria_id"] = cat_bd_id
                            skus_vistos.add(pid)
                            productos_raw.append(p)
                            nuevos += 1

                # Descubrir sub-categorías y propagar el código raíz
                new_cats = await page.evaluate(JS_EXTRAER_CAT_LINKS)
                agregadas = 0
                for nc in new_cats:
                    if nc not in cats_visitadas and nc not in cats_pendientes:
                        cats_pendientes.append(nc)
                        # Heredar raíz para que los productos de la sub-cat tengan la misma categoría BD
                        cat_root_map[nc] = root_code
                        agregadas += 1

                n_total = await page.evaluate("() => document.querySelectorAll('.producto-box').length")
                print(f"  . cat={cat_id:10s} | +{nuevos:3d} nuevos | {n_total:3d} DOM | "
                      f"pending={len(cats_pendientes)} | total={len(productos_raw)}")

            except Exception as e:
                print(f"  WARN: Error en categoria {cat_id}: {str(e)[:80]}")

        await browser.close()

    print(f"\n  -> {len(productos_raw)} productos unicos | {len(cats_visitadas)} categorias visitadas")
    return productos_raw


# ── Supabase helpers ──────────────────────────────────────────────────────────

async def cargar_supermercados(client: httpx.AsyncClient) -> dict[str, int]:
    r = await client.get(f"{REST_URL}/supermercados",
                         params={"select": "id,nombre_corto"}, headers=HEADERS)
    r.raise_for_status()
    return {row["nombre_corto"]: row["id"] for row in r.json()}


async def precargar_variantes(client: httpx.AsyncClient, super_id: int) -> tuple[dict, dict]:
    sku_map: dict[str, int] = {}
    ean_map: dict[str, int] = {}
    offset = 0
    while True:
        r = await client.get(
            f"{REST_URL}/producto_variantes",
            params={"select": "id,sku_local,producto_id,productos(ean)",
                    "supermercado_id": f"eq.{super_id}",
                    "limit": str(CHUNK), "offset": str(offset)},
            headers=HEADERS,
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
    nombre_map: dict[str, int] = {}
    offset = 0
    while True:
        r = await client.get(
            f"{REST_URL}/productos",
            params={"select": "id,nombre_normalizado", "limit": str(CHUNK), "offset": str(offset)},
            headers=HEADERS,
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
        r = await client.get(
            f"{REST_URL}/precios",
            headers=HEADERS,
            params={
                "select":      "variante_id",
                "variante_id": f"in.({','.join(str(v) for v in chunk)})",
                "fecha_hora":  f"gte.{cutoff}",
                "limit":       str(len(chunk)),
            },
        )
        if r.status_code == 200:
            for row in r.json():
                ya_insertados.add(row["variante_id"])

    if ya_insertados:
        print(f"  Guard: {len(ya_insertados)} variantes ya tienen precio en las últimas {ventana_horas}h — omitidas")

    return [p for p in precios_batch if p["variante_id"] not in ya_insertados]


async def guardar_en_supabase(productos: list[dict], super_id: int, client: httpx.AsyncClient) -> dict:
    print("  -> Pre-cargando cache...")
    sku_map, ean_map = await precargar_variantes(client, super_id)
    nombre_map = await precargar_nombres(client)

    nuevos = actualizados = errores = 0
    ahora = datetime.now(timezone.utc).isoformat()
    precios_batch: list[dict] = []

    for prod in productos:
        try:
            producto_id: Optional[int] = None
            ean = prod.get("ean")
            if ean and ean in ean_map:
                producto_id = ean_map[ean]
            if not producto_id:
                nn = prod.get("nombre_norm", "")
                if nn and nn in nombre_map:
                    producto_id = nombre_map[nn]

            if not producto_id:
                body = {
                    "nombre":             prod["nombre_local"],
                    "nombre_normalizado": prod["nombre_norm"],
                    "marca":              prod.get("marca"),
                    "ean":                ean,
                    "categoria_id":       prod.get("categoria_id"),
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
                # Parchear categoria_id si el producto existente la tiene vacía
                cat_id_bd = prod.get("categoria_id")
                if cat_id_bd is not None:
                    await client.patch(
                        f"{REST_URL}/productos",
                        json={"categoria_id": cat_id_bd},
                        headers=HEADERS_MIN,
                        params={"id": f"eq.{producto_id}", "categoria_id": "is.null"},
                    )

            sku = prod.get("sku_local") or f"sel_{prod['nombre_norm'][:40]}"
            var_body = {
                "producto_id":     producto_id,
                "supermercado_id": super_id,
                "sku_local":       sku,
                "nombre_local":    prod["nombre_local"],
                "url_producto":    prod.get("url_producto"),
                "imagen_url":      prod.get("imagen_url"),
            }
            r = await client.post(
                f"{REST_URL}/producto_variantes",
                json=var_body,
                headers=HEADERS_UPSERT,
                params={"on_conflict": "supermercado_id,sku_local"},
            )
            if r.status_code not in (200, 201):
                print(f"  WARN: variante error {r.status_code}: {r.text[:100]}")
                errores += 1
                continue
            var_rows = r.json()
            variante_id = var_rows[0]["id"] if isinstance(var_rows, list) else var_rows["id"]

            precios_batch.append({
                "variante_id":      variante_id,
                "precio_normal":    prod["precio_normal"],
                "precio_oferta":    prod.get("precio_oferta"),
                "en_oferta":        prod.get("en_oferta", False),
                "descuento_pct":    prod.get("descuento_pct"),
                "condicion_oferta": prod.get("condicion_oferta"),
                "disponible":       True,
                "fecha_hora":       ahora,
            })

        except Exception as e:
            errores += 1
            print(f"  WARN: error prod: {e}")

    # Guard: omitir variantes con precio reciente (< 6h)
    precios_batch = await _filtrar_ya_insertados(client, precios_batch)

    print(f"  -> Insertando {len(precios_batch)} precios...")
    for i in range(0, len(precios_batch), CHUNK):
        r = await client.post(f"{REST_URL}/precios",
                              json=precios_batch[i:i+CHUNK], headers=HEADERS_MIN)
        if r.status_code not in (200, 201):
            print(f"  WARN: precios error {r.status_code}")

    return {"nuevos": nuevos, "actualizados": actualizados, "errores": errores}


async def refrescar_vista(client: httpx.AsyncClient) -> None:
    r = await client.post(f"{SUPABASE_URL}/rest/v1/rpc/refrescar_precios_actuales",
                          json={}, headers=HEADERS)
    if r.status_code in (200, 204):
        print("  -> Vista 'precios_actuales' refrescada")
    else:
        print(f"  WARN: vista error {r.status_code}: {r.text[:80]}")


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    print(f"\n=== PreciosSV Selectos Scraper - {now_utc} ===")
    print(f"Supabase: {SUPABASE_URL}\n")

    async with httpx.AsyncClient(timeout=30) as client:
        supermercados = await cargar_supermercados(client)
        print(f"Supermercados: {supermercados}")

        super_id = supermercados.get(SUPERMERCADO_KEY)
        if not super_id:
            print(f"ERROR: '{SUPERMERCADO_KEY}' no encontrado")
            sys.exit(1)

        print(f"\n[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] Scrapeando Selectos...")
        productos = await scrape_selectos()

        if not productos:
            print("  -> Sin productos. Revisar conectividad.")
            return

        print(f"\n[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] Guardando en Supabase...")
        resumen = await guardar_en_supabase(productos, super_id, client)
        print(f"  -> +{resumen['nuevos']} nuevos, ~{resumen['actualizados']} actualizados, {resumen['errores']} errores")

        print(f"\n[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] Refrescando vista...")
        await refrescar_vista(client)

    print(f"\n=== Resumen ===")
    print(f"  Nuevos:       {resumen['nuevos']}")
    print(f"  Actualizados: {resumen['actualizados']}")
    print(f"  Errores:      {resumen['errores']}")


if __name__ == "__main__":
    asyncio.run(main())

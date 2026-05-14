"""
app/scrapers/pricesmart.py
Scraper para PriceSmart El Salvador (pricesmart.com/es-sv).
Usa Playwright porque el sitio es Nuxt.js + Bloomreach (carga dinámica).
Estrategia doble:
  1. Interceptar respuestas de red (API interna Bloomreach/PriceSmart)
  2. Fallback: extraer JSON-LD de schema.org desde el DOM renderizado
"""
import asyncio
import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from playwright.async_api import async_playwright, Page, Response
from tenacity import retry, stop_after_attempt, wait_fixed

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

BASE_URL = "https://www.pricesmart.com/es-sv"

# Categorías de alimentación, limpieza y cuidado personal
CATEGORIAS_PRICESMART = [
    ("Groceries",      "G10D53001"),   # Abarrotes generales
    ("Beverages",      "G10D53002"),   # Bebidas
    ("Dairy-Eggs",     "G10D53003"),   # Lácteos y Huevos
    ("Meat-Seafood",   "G10D53004"),   # Carnes
    ("Produce",        "G10D53005"),   # Frutas y Verduras
    ("Bakery",         "G10D53006"),   # Panadería
    ("Frozen",         "G10D53007"),   # Congelados
    ("Health-Beauty",  "G10D53010"),   # Cuidado Personal
    ("Cleaning",       "G10D53011"),   # Limpieza
]

# Keywords para detectar respuestas de API con productos
API_KEYWORDS = [
    "product", "item", "catalog", "search",
    "precio", "price", "sku", "category",
]

# Keywords para detectar API de Bloomreach/PriceSmart
BLOOMREACH_DOMAINS = [
    "bloomreach", "brconnector", "pathways.dxpapi",
    "pricesmart.com/api", "pricesmart.com/graphql",
]


class ScraperPriceSmart:
    """
    Scraper de PriceSmart El Salvador.
    Combina intercepción de red + JSON-LD para máxima cobertura.
    """

    def __init__(self):
        self.productos: list[dict] = []
        self.errores: int = 0
        self._skus_vistos: set[str] = set()
        self._urls_procesadas: set[str] = set()

    async def scrape(self) -> list[dict]:
        logger.info("Iniciando scrape PriceSmart El Salvador")
        inicio = datetime.now(timezone.utc)

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=settings.scraper_headless,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-blink-features=AutomationControlled",
                ],
            )
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1440, "height": 900},
                locale="es-SV",
                extra_http_headers={
                    "Accept-Language": "es-SV,es;q=0.9,en;q=0.8",
                },
            )
            page = await context.new_page()

            # Interceptar todas las respuestas de red
            page.on("response", self._manejar_respuesta)

            for slug, codigo in CATEGORIAS_PRICESMART:
                await self._scrape_categoria(page, slug, codigo)
                logger.debug(
                    "Categoría PriceSmart completada",
                    categoria=slug,
                    productos_total=len(self.productos),
                )

            await browser.close()

        duracion = (datetime.now(timezone.utc) - inicio).seconds
        logger.info(
            "Scrape PriceSmart completado",
            productos=len(self.productos),
            errores=self.errores,
            duracion_seg=duracion,
        )
        return self.productos

    async def _scrape_categoria(self, page: Page, slug: str, codigo: str) -> None:
        """Itera todas las páginas de una categoría."""
        pagina = 1
        max_paginas = 20  # tope de seguridad

        while pagina <= max_paginas:
            url = f"{BASE_URL}/category/{slug}/{codigo}?page={pagina}"
            try:
                await page.goto(url, wait_until="networkidle", timeout=40_000)
                await self._scroll_completo(page)
                await asyncio.sleep(2)

                # Fallback: extraer JSON-LD del DOM
                nuevos = await self._extraer_jsonld(page)
                if not nuevos and pagina > 1:
                    # Sin productos nuevos en esta página → fin de categoría
                    break

                pagina += 1
                await asyncio.sleep(settings.scraper_delay_seconds)

            except Exception as e:
                logger.error(
                    "Error scrapeando PriceSmart",
                    categoria=slug, pagina=pagina, error=str(e)
                )
                self.errores += 1
                break

    async def _scroll_completo(self, page: Page) -> None:
        """Scroll gradual para activar lazy-loading de productos."""
        altura_anterior = -1
        intentos = 0
        while intentos < 10:
            altura_actual = await page.evaluate("document.body.scrollHeight")
            if altura_actual == altura_anterior:
                break
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await asyncio.sleep(1.5)
            altura_anterior = altura_actual
            intentos += 1

    # ── Intercepción de red ──────────────────────────────────

    async def _manejar_respuesta(self, response: Response) -> None:
        """
        Callback por cada respuesta de red.
        Busca respuestas JSON de la API de productos.
        """
        url = response.url
        if url in self._urls_procesadas:
            return

        # Filtrar por URLs relevantes
        url_lower = url.lower()
        es_api_conocida = any(d in url_lower for d in BLOOMREACH_DOMAINS)
        tiene_keyword = any(k in url_lower for k in API_KEYWORDS)

        if not (es_api_conocida or tiene_keyword):
            return

        content_type = response.headers.get("content-type", "")
        if "json" not in content_type:
            return

        try:
            data = await response.json()
            self._urls_procesadas.add(url)
            antes = len(self.productos)
            self._extraer_de_json(data)
            nuevos = len(self.productos) - antes
            if nuevos:
                logger.debug("Productos capturados via red", url=url, nuevos=nuevos)
        except Exception:
            pass

    def _extraer_de_json(self, data) -> None:
        """Extrae productos de respuesta JSON de cualquier estructura."""
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and self._parece_producto(item):
                    prod = self._parsear_producto_api(item)
                    if prod:
                        self._agregar(prod)
            return

        if not isinstance(data, dict):
            return

        # Claves comunes de APIs de productos
        for clave in ("products", "items", "data", "results", "response",
                      "hits", "docs", "catalog", "Products", "Items"):
            val = data.get(clave)
            if isinstance(val, list):
                for item in val:
                    if isinstance(item, dict) and self._parece_producto(item):
                        prod = self._parsear_producto_api(item)
                        if prod:
                            self._agregar(prod)
                return
            if isinstance(val, dict):
                self._extraer_de_json(val)

        # ¿Es un solo producto?
        if self._parece_producto(data):
            prod = self._parsear_producto_api(data)
            if prod:
                self._agregar(prod)

    def _parece_producto(self, item: dict) -> bool:
        tiene_precio = any(k in item for k in (
            "price", "Price", "salePrice", "listPrice",
            "regularPrice", "currentPrice", "precio",
        ))
        tiene_nombre = any(k in item for k in (
            "name", "Name", "title", "productName",
            "displayName", "nombre", "description",
        ))
        return tiene_precio and tiene_nombre

    def _parsear_producto_api(self, item: dict) -> Optional[dict]:
        try:
            nombre = (
                item.get("name") or item.get("Name") or
                item.get("productName") or item.get("displayName") or
                item.get("title") or item.get("nombre") or ""
            ).strip()
            if not nombre:
                return None

            precio_normal_raw = (
                item.get("listPrice") or item.get("regularPrice") or
                item.get("Price") or item.get("price") or
                item.get("originalPrice") or 0
            )
            precio_normal = Decimal(str(precio_normal_raw))
            if precio_normal <= 0:
                return None

            precio_oferta_raw = (
                item.get("salePrice") or item.get("currentPrice") or
                item.get("discountedPrice") or item.get("promotionalPrice")
            )
            precio_oferta = None
            if precio_oferta_raw:
                precio_oferta = Decimal(str(precio_oferta_raw))
                if precio_oferta >= precio_normal:
                    precio_oferta = None

            en_oferta = precio_oferta is not None
            descuento_pct = None
            if en_oferta and precio_normal > 0:
                descuento_pct = round(
                    float((precio_normal - precio_oferta) / precio_normal * 100), 2
                )

            sku = str(
                item.get("sku") or item.get("id") or item.get("productId") or
                item.get("itemId") or item.get("code") or ""
            )

            imagen = (
                item.get("imageUrl") or item.get("image") or
                item.get("thumbnail") or item.get("img") or
                (item.get("images") or [None])[0] if isinstance(item.get("images"), list) else None
            )

            slug_prod = item.get("slug") or item.get("url") or item.get("link") or ""
            url_prod = (
                f"{BASE_URL}/product/{slug_prod}" if slug_prod and not slug_prod.startswith("http")
                else slug_prod or BASE_URL
            )

            marca = (
                item.get("brand") or item.get("Brand") or
                item.get("manufacturer") or ""
            )

            return {
                "supermercado_key": "pricesmart",
                "nombre_local":     nombre,
                "marca":            marca.strip() or None,
                "sku_local":        sku or nombre[:50],
                "ean":              item.get("ean") or item.get("upc") or item.get("barcode") or None,
                "precio_normal":    precio_normal,
                "precio_oferta":    precio_oferta,
                "en_oferta":        en_oferta,
                "descuento_pct":    descuento_pct,
                "descripcion":      (item.get("description") or "").strip() or None,
                "imagen_url":       imagen,
                "url_producto":     url_prod,
                "disponible":       item.get("available", item.get("inStock", True)),
                "condicion_oferta": item.get("promotionName") or item.get("offerText") or None,
                "categoria_nombre": item.get("categoryName") or item.get("category") or None,
                "fecha_hora":       datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            logger.warning("Error parseando producto PriceSmart (API)", error=str(e))
            self.errores += 1
            return None

    # ── Fallback: JSON-LD del DOM ────────────────────────────

    async def _extraer_jsonld(self, page: Page) -> int:
        """
        Extrae productos desde <script type='application/ld+json'> en el DOM.
        Retorna cantidad de productos nuevos encontrados.
        """
        antes = len(self.productos)
        try:
            scripts = await page.evaluate("""
                () => Array.from(
                    document.querySelectorAll('script[type="application/ld+json"]')
                ).map(s => s.textContent)
            """)

            for script_text in scripts:
                try:
                    data = json.loads(script_text)
                    self._procesar_jsonld(data)
                except Exception:
                    continue

            # También intentar extraer desde el DOM directamente si JSON-LD no dio nada
            if len(self.productos) == antes:
                await self._extraer_dom(page)

        except Exception as e:
            logger.debug("Error extrayendo JSON-LD", error=str(e))

        return len(self.productos) - antes

    def _procesar_jsonld(self, data) -> None:
        """Procesa estructura JSON-LD (schema.org Product, ItemList, etc.)."""
        if isinstance(data, list):
            for item in data:
                self._procesar_jsonld(item)
            return

        if not isinstance(data, dict):
            return

        tipo = data.get("@type", "")

        # Product individual
        if tipo == "Product":
            prod = self._parsear_jsonld_producto(data)
            if prod:
                self._agregar(prod)
            return

        # ItemList con productos
        if tipo in ("ItemList", "ProductCollection"):
            for elemento in data.get("itemListElement", []):
                if isinstance(elemento, dict):
                    item = elemento.get("item", elemento)
                    if isinstance(item, dict):
                        prod = self._parsear_jsonld_producto(item)
                        if prod:
                            self._agregar(prod)
            return

        # Buscar recursivamente en @graph
        for graph_item in data.get("@graph", []):
            self._procesar_jsonld(graph_item)

    def _parsear_jsonld_producto(self, item: dict) -> Optional[dict]:
        try:
            nombre = item.get("name", "").strip()
            if not nombre:
                return None

            # Precio desde offers
            offers = item.get("offers", {})
            if isinstance(offers, list):
                offers = offers[0] if offers else {}

            precio_normal_raw = offers.get("price") or offers.get("highPrice") or 0
            precio_normal = Decimal(str(precio_normal_raw))
            if precio_normal <= 0:
                return None

            precio_oferta = None
            precio_low = offers.get("lowPrice")
            if precio_low:
                plo = Decimal(str(precio_low))
                if plo < precio_normal:
                    precio_oferta = plo

            en_oferta = precio_oferta is not None
            descuento_pct = None
            if en_oferta and precio_normal > 0:
                descuento_pct = round(
                    float((precio_normal - precio_oferta) / precio_normal * 100), 2
                )

            sku = str(item.get("sku") or item.get("productID") or "")
            imagen = item.get("image")
            if isinstance(imagen, list):
                imagen = imagen[0] if imagen else None
            if isinstance(imagen, dict):
                imagen = imagen.get("url")

            url_prod = item.get("url") or BASE_URL

            return {
                "supermercado_key": "pricesmart",
                "nombre_local":     nombre,
                "marca":            (item.get("brand", {}).get("name", "") if isinstance(item.get("brand"), dict) else item.get("brand", "")).strip() or None,
                "sku_local":        sku or nombre[:50],
                "ean":              item.get("gtin") or item.get("gtin13") or item.get("gtin12") or None,
                "precio_normal":    precio_normal,
                "precio_oferta":    precio_oferta,
                "en_oferta":        en_oferta,
                "descuento_pct":    descuento_pct,
                "descripcion":      item.get("description", "").strip() or None,
                "imagen_url":       imagen,
                "url_producto":     url_prod,
                "disponible":       offers.get("availability", "").find("InStock") >= 0
                                    if offers.get("availability") else True,
                "condicion_oferta": None,
                "categoria_nombre": None,
                "fecha_hora":       datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            logger.warning("Error parseando JSON-LD PriceSmart", error=str(e))
            return None

    async def _extraer_dom(self, page: Page) -> None:
        """
        Último recurso: extraer precios directamente del DOM renderizado.
        Busca selectores comunes de tarjetas de producto en Nuxt.js/Bloomreach.
        """
        try:
            productos_dom = await page.evaluate("""
                () => {
                    const tarjetas = document.querySelectorAll(
                        '[class*="product-card"], [class*="ProductCard"], ' +
                        '[class*="product-item"], [class*="ProductTile"], ' +
                        '[data-product-id], [data-sku]'
                    );
                    return Array.from(tarjetas).map(el => {
                        const nombre = (
                            el.querySelector('[class*="name"], [class*="title"], h2, h3')
                            || {}
                        ).textContent?.trim() || '';

                        const precioEl = el.querySelector(
                            '[class*="price"], [class*="Price"], ' +
                            '[class*="monto"], [data-price]'
                        );
                        const precioText = precioEl?.textContent?.trim() || '';
                        const precioNum = parseFloat(
                            precioText.replace(/[^0-9.]/g, '')
                        ) || 0;

                        const img = el.querySelector('img');
                        const link = el.querySelector('a');

                        return {
                            nombre,
                            precio: precioNum,
                            imagen: img?.src || img?.dataset?.src || null,
                            url: link?.href || null,
                            sku: el.dataset?.productId || el.dataset?.sku || '',
                        };
                    }).filter(p => p.nombre && p.precio > 0);
                }
            """)

            for p in productos_dom:
                prod = {
                    "supermercado_key": "pricesmart",
                    "nombre_local":     p["nombre"],
                    "marca":            None,
                    "sku_local":        p["sku"] or p["nombre"][:50],
                    "ean":              None,
                    "precio_normal":    Decimal(str(p["precio"])),
                    "precio_oferta":    None,
                    "en_oferta":        False,
                    "descuento_pct":    None,
                    "descripcion":      None,
                    "imagen_url":       p["imagen"],
                    "url_producto":     p["url"] or BASE_URL,
                    "disponible":       True,
                    "condicion_oferta": None,
                    "categoria_nombre": None,
                    "fecha_hora":       datetime.now(timezone.utc).isoformat(),
                }
                self._agregar(prod)

        except Exception as e:
            logger.debug("Error extrayendo DOM PriceSmart", error=str(e))

    def _agregar(self, prod: dict) -> None:
        """Agrega producto evitando duplicados por SKU."""
        sku = prod.get("sku_local", "")
        if sku and sku in self._skus_vistos:
            return
        if sku:
            self._skus_vistos.add(sku)
        self.productos.append(prod)

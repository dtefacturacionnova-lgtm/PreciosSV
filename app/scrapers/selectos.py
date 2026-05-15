"""
app/scrapers/selectos.py
Scraper para Súper Selectos (superselectos.com).
Usa Playwright porque el sitio carga con Angular/JS dinámico.
Estrategia: interceptar las llamadas de red internas (más limpio que parsear HTML).
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

BASE_URL = "https://www.superselectos.com"

# Categorías conocidas de Selectos para iterar
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


class ScraperSelectos:
    """
    Scraper de Súper Selectos.
    Intercepta respuestas JSON de la API interna del sitio Angular.
    """

    def __init__(self):
        self.productos: list[dict] = []
        self.errores: int = 0
        self._urls_vistas: set[str] = set()  # evitar duplicados entre categorías

    async def scrape(self) -> list[dict]:
        logger.info("Iniciando scrape Selectos")
        inicio = datetime.now(timezone.utc)

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=settings.scraper_headless,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1280, "height": 800},
                locale="es-SV",
            )
            page = await context.new_page()

            # Interceptar todas las respuestas de red
            page.on("response", self._manejar_respuesta)

            for categoria in CATEGORIAS_SELECTOS:
                await self._scrape_categoria(page, categoria)
                logger.debug("Categoría completada", categoria=categoria,
                             productos_total=len(self.productos))

            await browser.close()

        duracion = (datetime.now(timezone.utc) - inicio).seconds
        logger.info(
            "Scrape Selectos completado",
            productos=len(self.productos),
            errores=self.errores,
            duracion_seg=duracion,
        )
        return self.productos

    async def _scrape_categoria(self, page: Page, categoria: str) -> None:
        url = f"{BASE_URL}/Tienda/Catalogo/{categoria}"
        try:
            # domcontentloaded es más rápido y confiable en CI que networkidle
            # Angular carga el contenido dinámicamente; esperamos la carga inicial
            # y luego scrolleamos para activar el lazy-loading
            await page.goto(url, wait_until="domcontentloaded", timeout=90_000)

            # Esperar a que Angular monte los productos (~3-8 s en CI)
            await asyncio.sleep(5)

            # Hacer scroll para activar lazy-loading de productos
            await self._scroll_completo(page)

            # Pequeña pausa para que carguen las últimas peticiones de red
            await asyncio.sleep(3)

        except Exception as e:
            logger.error("Error scrapeando categoría Selectos",
                         categoria=categoria, error=str(e))
            self.errores += 1

    async def _scroll_completo(self, page: Page) -> None:
        """Scroll gradual hasta el final de la página."""
        altura_anterior = -1
        while True:
            altura_actual = await page.evaluate("document.body.scrollHeight")
            if altura_actual == altura_anterior:
                break
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await asyncio.sleep(1.5)
            altura_anterior = altura_actual

    async def _manejar_respuesta(self, response: Response) -> None:
        """
        Callback que se ejecuta por cada respuesta de red.
        Filtra solo las que contienen datos de productos.
        """
        url = response.url

        # Evitar procesar la misma URL dos veces
        if url in self._urls_vistas:
            return

        # Filtrar solo URLs relevantes (API interna de Selectos / VTEX)
        keywords = [
            "producto", "catalog", "search", "item", "sku",
            "graphql", "api/io", "_v/api", "shelf", "productList",
            "intelligentsearch", "product-summary",
        ]
        if not any(k in url.lower() for k in keywords):
            return

        # Solo aceptar JSON
        content_type = response.headers.get("content-type", "")
        if "json" not in content_type:
            return

        try:
            data = await response.json()
            self._urls_vistas.add(url)
            self._extraer_productos(data)
        except Exception:
            pass  # No es JSON válido o está vacío — ignorar silenciosamente

    def _extraer_productos(self, data) -> None:
        """
        Intenta extraer productos de cualquier estructura JSON
        que devuelva el sitio de Selectos.
        """
        # Caso 1: lista directa
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and self._parece_producto(item):
                    producto = self._parsear_producto(item)
                    if producto:
                        self.productos.append(producto)
            return

        if not isinstance(data, dict):
            return

        # Caso 2: envuelto en clave conocida
        for clave in ("products", "items", "data", "Products", "Items", "result"):
            if clave in data and isinstance(data[clave], list):
                for item in data[clave]:
                    if isinstance(item, dict) and self._parece_producto(item):
                        producto = self._parsear_producto(item)
                        if producto:
                            self.productos.append(producto)
                return

        # Caso 3: es un solo producto
        if self._parece_producto(data):
            producto = self._parsear_producto(data)
            if producto:
                self.productos.append(producto)

    def _parece_producto(self, item: dict) -> bool:
        """
        Heurística: ¿tiene campos de precio y nombre?
        Cubre tanto la API flat de Selectos como la estructura anidada de VTEX IO.
        """
        tiene_precio = any(k in item for k in (
            "Price", "precio", "price", "ListPrice", "PriceWithDiscount",
            # VTEX IO: precio está anidado en items[].sellers[].commertialOffer
            # pero si el objeto tiene "items" con sellers → es un producto VTEX
            "priceRange", "spotPrice",
        )) or (
            # VTEX IO product object: precios dentro de items[]
            "items" in item and isinstance(item.get("items"), list) and bool(item["items"])
        )
        tiene_nombre = any(k in item for k in (
            "ProductName", "productName",   # VTEX catalog + VTEX IO
            "nombre", "name", "Name", "Title",
        ))
        return tiene_precio and tiene_nombre

    def _parsear_producto(self, item: dict) -> Optional[dict]:
        """
        Normaliza los campos del JSON de Selectos al formato interno.
        Cubre dos formatos:
          • Flat: API propia de Selectos (Price, ProductName, EAN en raíz)
          • VTEX IO nested: items[0].ean, items[0].sellers[0].commertialOffer.Price
        """
        try:
            # ── SKU anidado (VTEX IO) vs flat ─────────────────
            nested_items = item.get("items") or item.get("Items") or []
            sku_nested: dict = (
                nested_items[0]
                if nested_items and isinstance(nested_items, list) and isinstance(nested_items[0], dict)
                else {}
            )

            # ── Nombre ─────────────────────────────────────────
            nombre = (
                item.get("productName")        # VTEX IO
                or item.get("ProductName")
                or item.get("Name")
                or item.get("nombre")
                or item.get("name")
                or sku_nested.get("nameComplete")
                or ""
            ).strip()

            if not nombre:
                return None

            # ── Precios ─────────────────────────────────────────
            # Intentar extraer desde seller anidado (VTEX IO)
            sellers_nested = sku_nested.get("sellers") or []
            offer_nested: dict = (
                sellers_nested[0].get("commertialOffer", {})
                if sellers_nested and isinstance(sellers_nested[0], dict)
                else {}
            )

            precio_normal_raw = (
                offer_nested.get("ListPrice")
                or offer_nested.get("Price")
                or item.get("ListPrice")
                or item.get("PriceWithoutDiscount")
                or item.get("Price")
                or item.get("precio")
                or 0
            )
            precio_normal = Decimal(str(precio_normal_raw))

            precio_oferta_raw = (
                offer_nested.get("Price") if offer_nested.get("Price") and
                    Decimal(str(offer_nested.get("Price", 0))) < precio_normal else None
            ) or (
                item.get("PriceWithDiscount")
                or item.get("SalePrice")
                or item.get("precioOferta")
            )
            precio_oferta = Decimal(str(precio_oferta_raw)) if precio_oferta_raw else None

            # Validar que precio_oferta sea realmente menor
            if precio_oferta and precio_oferta >= precio_normal:
                precio_oferta = None

            if precio_normal <= 0:
                return None

            en_oferta = precio_oferta is not None
            descuento_pct = None
            if en_oferta and precio_normal > 0:
                descuento_pct = round(
                    float((precio_normal - precio_oferta) / precio_normal * 100), 2
                )

            # ── EAN ─────────────────────────────────────────────
            ean = (
                item.get("EAN") or item.get("ean")                 # API flat
                or sku_nested.get("ean") or sku_nested.get("EAN")  # VTEX IO nested
                or None
            )
            if not ean:
                # referenceId en SKU anidado: [{"Key": "RefId", "Value": "..."}]
                for ref in (sku_nested.get("referenceId") or []):
                    if isinstance(ref, dict):
                        k = ref.get("Key", "").upper()
                        if k in ("EAN", "GTIN", "EAN13", "BARCODE"):
                            v = str(ref.get("Value", "")).strip()
                            if v:
                                ean = v
                                break

            # ── SKU / ID ────────────────────────────────────────
            sku = str(
                item.get("productId") or item.get("ProductId")
                or item.get("Id") or item.get("id")
                or sku_nested.get("itemId")
                or ""
            )

            # ── Imagen ──────────────────────────────────────────
            imagenes_nested = sku_nested.get("images") or []
            imagen_url = (
                (imagenes_nested[0].get("imageUrl") if imagenes_nested else None)
                or item.get("ImageUrl")
                or item.get("imagen")
                or item.get("image")
            )

            # ── URL del producto ────────────────────────────────
            link_text = (
                item.get("linkText") or item.get("LinkText") or item.get("slug") or ""
            )
            url_producto = f"{BASE_URL}/{link_text}/p" if link_text else BASE_URL

            # ── Marca ────────────────────────────────────────────
            marca = (
                item.get("brand") or item.get("BrandName") or item.get("Brand")
                or item.get("marca")
                or ""
            ).strip() or None

            # ── Disponibilidad ──────────────────────────────────
            disponible = (
                offer_nested.get("IsAvailable", True)
                if offer_nested else item.get("IsAvailable", True)
            )

            return {
                "supermercado_key": "selectos",
                "nombre_local":     nombre,
                "marca":            marca,
                "sku_local":        sku,
                "ean":              ean,
                "precio_normal":    precio_normal,
                "precio_oferta":    precio_oferta,
                "en_oferta":        en_oferta,
                "descuento_pct":    descuento_pct,
                "descripcion":      (item.get("Description") or item.get("description") or item.get("descripcion") or "").strip() or None,
                "imagen_url":       imagen_url,
                "url_producto":     url_producto,
                "disponible":       disponible,
                "condicion_oferta": item.get("PromotionName") or item.get("condicion") or None,
                "categoria_nombre": item.get("categories", [None])[0] if item.get("categories") else (
                    item.get("CategoryName") or item.get("categoria") or None
                ),
                "fecha_hora":       datetime.now(timezone.utc).isoformat(),
            }

        except Exception as e:
            logger.warning("Error parseando producto Selectos", error=str(e))
            self.errores += 1
            return None

"""
app/scrapers/vtex.py
Scraper para la plataforma VTEX.
Cubre: Walmart SV, Despensa Don Juan, Maxi Despensa, Despensa Familiar.
Las 4 cadenas usan la misma API — un solo scraper las cubre todas.
"""
import asyncio
from datetime import datetime, timezone
from typing import Optional
from decimal import Decimal

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# ── Configuración de tiendas VTEX ───────────────────────────
TIENDAS_VTEX = {
    "walmart": {
        "nombre": "Walmart El Salvador",
        "nombre_corto": "walmart",
        "base_url": "https://www.walmart.com.sv",
        "account_name": "walmartelsalvador",
    },
    "donjuan": {
        "nombre": "La Despensa de Don Juan",
        "nombre_corto": "donjuan",
        "base_url": "https://www.ladespensadedonjuan.com.sv",
        "account_name": "despensadedonjuan",
    },
    "maxidespensa": {
        "nombre": "Maxi Despensa",
        "nombre_corto": "maxidespensa",
        "base_url": "https://www.maxidespensa.com.sv",
        "account_name": "maxidespensa",
    },
    "familiar": {
        "nombre": "Despensa Familiar",
        "nombre_corto": "familiar",
        "base_url": "https://www.despensafamiliar.com.sv",
        "account_name": "despensafamiliar",
    },
}

# ── Headers que simulan un navegador real ───────────────────
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "es-SV,es;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.google.com/",
}


class ScraperVTEX:
    """
    Scraper genérico para cualquier tienda que corra en VTEX.
    La API de VTEX es pública y consistente entre todas sus tiendas.
    """

    def __init__(self, tienda_key: str):
        if tienda_key not in TIENDAS_VTEX:
            raise ValueError(f"Tienda desconocida: {tienda_key}. Opciones: {list(TIENDAS_VTEX)}")
        self.config = TIENDAS_VTEX[tienda_key]
        self.tienda_key = tienda_key
        self.base_url = self.config["base_url"]
        self.productos_encontrados: list[dict] = []
        self.errores: int = 0

    @retry(
        stop=stop_after_attempt(settings.scraper_max_retries),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.ConnectError)),
    )
    async def _get(self, client: httpx.AsyncClient, url: str, params: dict = None) -> dict | list:
        """GET con reintentos automáticos en timeout/error de conexión."""
        resp = await client.get(url, params=params, headers=HEADERS,
                                timeout=settings.scraper_timeout_seconds)
        resp.raise_for_status()
        return resp.json()

    async def scrape(self) -> list[dict]:
        """
        Punto de entrada principal.
        Retorna lista de dicts con datos crudos de productos.
        """
        logger.info("Iniciando scrape VTEX", tienda=self.tienda_key)
        inicio = datetime.now(timezone.utc)

        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=settings.scraper_timeout_seconds,
        ) as client:
            await self._scrape_por_paginas(client)

        duracion = (datetime.now(timezone.utc) - inicio).seconds
        logger.info(
            "Scrape VTEX completado",
            tienda=self.tienda_key,
            productos=len(self.productos_encontrados),
            errores=self.errores,
            duracion_seg=duracion,
        )
        return self.productos_encontrados

    async def _obtener_categorias(self, client: httpx.AsyncClient) -> list[int]:
        """
        Obtiene IDs de categorías hoja desde el árbol de categorías VTEX.
        Nivel 3 cubre: Departamento > Categoría > Sub-categoría.
        """
        try:
            url = f"{self.base_url}/api/catalog_system/pub/category/tree/3"
            tree = await self._get(client, url)
            ids: list[int] = []

            def _recorrer(nodo: dict | list) -> None:
                if isinstance(nodo, list):
                    for item in nodo:
                        _recorrer(item)
                    return
                children = nodo.get("children") or []
                if not children:
                    ids.append(nodo["id"])
                else:
                    for child in children:
                        _recorrer(child)

            _recorrer(tree)
            return ids
        except Exception as e:
            logger.warning("No se pudo obtener árbol de categorías VTEX",
                           tienda=self.tienda_key, error=str(e))
            return []

    async def _scrape_categoria(self, client: httpx.AsyncClient, cat_id: int) -> None:
        """Pagina todos los productos de una categoría VTEX usando fq=C:/{id}/."""
        page_size = 50
        desde = 0
        skus_vistos: set[str] = set()

        while True:
            url = f"{self.base_url}/api/catalog_system/pub/products/search"
            params = {
                "fq": f"C:/{cat_id}/",
                "_from": desde,
                "_to": desde + page_size - 1,
                "O": "OrderByTopSaleDESC",
            }
            try:
                items = await self._get(client, url, params)
            except httpx.HTTPStatusError as e:
                logger.error("Error HTTP en VTEX cat", tienda=self.tienda_key,
                             cat_id=cat_id, status=e.response.status_code)
                self.errores += 1
                break
            except Exception as e:
                logger.error("Error inesperado en VTEX cat", tienda=self.tienda_key,
                             cat_id=cat_id, error=str(e))
                self.errores += 1
                break

            if not items:
                break

            nuevos = 0
            for item in items:
                sku_id = str(item.get("productId", ""))
                if sku_id and sku_id in skus_vistos:
                    continue
                if sku_id:
                    skus_vistos.add(sku_id)
                producto = self._parsear_producto(item)
                if producto:
                    self.productos_encontrados.append(producto)
                    nuevos += 1

            if nuevos == 0:
                break

            desde += page_size
            await asyncio.sleep(settings.scraper_delay_seconds)

    async def _scrape_por_paginas(self, client: httpx.AsyncClient) -> None:
        """
        Estrategia principal:
        1. Intenta el search root (funciona para Walmart y tiendas VTEX abiertas).
        2. Si devuelve 0 resultados, obtiene el árbol de categorías e itera.
        """
        page_size = 50
        desde = 0

        # ── Intento 1: search root sin categoría ─────────────────
        while True:
            url = f"{self.base_url}/api/catalog_system/pub/products/search"
            params = {
                "_from": desde,
                "_to": desde + page_size - 1,
                "O": "OrderByTopSaleDESC",
                "map": "c",
            }

            try:
                items = await self._get(client, url, params)
            except httpx.HTTPStatusError as e:
                logger.error("Error HTTP en VTEX root", tienda=self.tienda_key,
                             status=e.response.status_code, desde=desde)
                self.errores += 1
                break
            except Exception as e:
                logger.error("Error inesperado en VTEX root", tienda=self.tienda_key,
                             error=str(e), desde=desde)
                self.errores += 1
                break

            if not items:
                break

            for item in items:
                producto = self._parsear_producto(item)
                if producto:
                    self.productos_encontrados.append(producto)

            logger.debug("Página scrapeada (root)", tienda=self.tienda_key,
                         desde=desde, obtenidos=len(items))

            desde += page_size
            await asyncio.sleep(settings.scraper_delay_seconds)

        # ── Intento 2: iterar por categorías si root no devolvió nada ──
        if len(self.productos_encontrados) == 0:
            logger.info("Root VTEX vacío — usando árbol de categorías",
                        tienda=self.tienda_key)
            cat_ids = await self._obtener_categorias(client)
            logger.info("Categorías encontradas", tienda=self.tienda_key,
                        total_cats=len(cat_ids))

            for cat_id in cat_ids:
                prev_total = len(self.productos_encontrados)
                await self._scrape_categoria(client, cat_id)
                nuevos = len(self.productos_encontrados) - prev_total
                if nuevos:
                    logger.debug("Categoría completada", tienda=self.tienda_key,
                                 cat_id=cat_id, nuevos=nuevos)

    def _parsear_producto(self, item: dict) -> Optional[dict]:
        """
        Convierte el JSON raw de VTEX al formato interno de PrecioSV.
        """
        try:
            # SKU principal (primer ítem)
            skus = item.get("items", [])
            if not skus:
                return None
            sku = skus[0]

            # Precio desde el primer seller
            sellers = sku.get("sellers", [])
            if not sellers:
                return None
            offer = sellers[0].get("commertialOffer", {})

            precio_lista = Decimal(str(offer.get("ListPrice") or offer.get("Price") or 0))
            precio_venta = Decimal(str(offer.get("Price") or 0))

            if precio_lista <= 0 and precio_venta <= 0:
                return None

            # Si precio de venta < lista → hay oferta
            en_oferta = precio_venta < precio_lista and precio_venta > 0
            precio_normal = precio_lista if precio_lista > 0 else precio_venta
            precio_oferta = precio_venta if en_oferta else None

            # Descuento %
            descuento_pct = None
            if en_oferta and precio_normal > 0:
                descuento_pct = round(
                    float((precio_normal - precio_oferta) / precio_normal * 100), 2
                )

            # Imagen
            imagenes = sku.get("images", [])
            imagen_url = imagenes[0].get("imageUrl") if imagenes else None

            # Categoría: VTEX retorna path "/Abarrotes/Aceites/"
            categorias_raw = item.get("categories", [])
            categoria_nombre = None
            if categorias_raw:
                partes = categorias_raw[0].strip("/").split("/")
                categoria_nombre = partes[0] if partes else None

            return {
                "supermercado_key": self.tienda_key,
                "nombre_local": item.get("productName", "").strip(),
                "marca": (item.get("brand") or "").strip() or None,
                "sku_local": str(item.get("productId", "")),
                "ean": sku.get("ean") or None,
                "precio_normal": precio_normal,
                "precio_oferta": precio_oferta,
                "en_oferta": en_oferta,
                "descuento_pct": descuento_pct,
                "descripcion": (item.get("description") or "").strip() or None,
                "imagen_url": imagen_url,
                "url_producto": (
                    f"{self.base_url}/{item.get('linkText', '')}/p"
                ),
                "disponible": offer.get("IsAvailable", False),
                "condicion_oferta": self._extraer_condicion(offer),
                "categoria_nombre": categoria_nombre,
                "fecha_hora": datetime.now(timezone.utc).isoformat(),
            }

        except Exception as e:
            logger.warning("Error parseando producto VTEX",
                           tienda=self.tienda_key, error=str(e))
            self.errores += 1
            return None

    def _extraer_condicion(self, offer: dict) -> Optional[str]:
        """
        Extrae condiciones de oferta especiales como '2x1', '3x2', etc.
        VTEX las guarda en el array 'Teasers'.
        """
        teasers = offer.get("Teasers", [])
        if not teasers:
            return None
        nombres = [t.get("name", "") for t in teasers if t.get("name")]
        return ", ".join(nombres) if nombres else None


async def scrape_todas_las_tiendas_vtex() -> dict[str, list[dict]]:
    """
    Ejecuta scrapers de todas las tiendas VTEX en paralelo.
    Retorna dict con key=tienda_key, value=lista de productos.
    """
    tareas = {
        key: ScraperVTEX(key).scrape()
        for key in TIENDAS_VTEX
    }

    resultados = await asyncio.gather(*tareas.values(), return_exceptions=True)

    salida = {}
    for key, resultado in zip(tareas.keys(), resultados):
        if isinstance(resultado, Exception):
            logger.error("Fallo scraper VTEX", tienda=key, error=str(resultado))
            salida[key] = []
        else:
            salida[key] = resultado

    return salida

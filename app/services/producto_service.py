"""
app/services/producto_service.py
Normalización, product matching y persistencia de productos scraped.
Recibe datos crudos del scraper y los guarda correctamente en PostgreSQL.
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.models import (
    Producto, ProductoVariante, Precio,
    Supermercado, Categoria, EjecucionScraper,
)
from app.services.matching_service import MatchingService

logger = get_logger(__name__)


class ProductoService:
    """
    Orquesta el flujo completo:
    raw dict → normalizar → matching IA → upsert BD → guardar precio.
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.matching = MatchingService()
        self._cache_supermercados: dict[str, int] = {}
        self._cache_categorias: dict[str, int] = {}

    # ── Punto de entrada principal ───────────────────────────
    async def procesar_lote(
        self,
        productos_raw: list[dict],
        ejecucion_id: int,
    ) -> dict:
        """
        Procesa una lista de productos crudos del scraper.
        Pre-carga todos los SKUs existentes en una sola query por supermercado
        para evitar hacer un SELECT por cada producto del lote.
        """
        nuevos = 0
        actualizados = 0
        errores = 0

        skus_existentes = await self._precargar_skus(productos_raw)

        for raw in productos_raw:
            try:
                resultado = await self._procesar_uno(raw, skus_existentes)
                if resultado == "nuevo":
                    nuevos += 1
                elif resultado == "actualizado":
                    actualizados += 1
            except Exception as e:
                logger.error("Error procesando producto", error=str(e), raw=str(raw)[:100])
                errores += 1

        await self._actualizar_ejecucion(ejecucion_id, nuevos, actualizados, errores)
        logger.info("Lote procesado", nuevos=nuevos, actualizados=actualizados, errores=errores)
        return {"nuevos": nuevos, "actualizados": actualizados, "errores": errores}

    async def _precargar_skus(self, productos_raw: list[dict]) -> dict[tuple, int]:
        """
        Una query por supermercado para traer todos los variante_id conocidos.
        Retorna {(supermercado_key, sku_local): variante_id}.
        """
        por_supermercado: dict[str, list[str]] = {}
        for raw in productos_raw:
            por_supermercado.setdefault(raw["supermercado_key"], []).append(raw["sku_local"])

        existentes: dict[tuple, int] = {}
        for super_key, skus in por_supermercado.items():
            super_id = await self._get_supermercado_id(super_key)
            if not super_id:
                continue
            result = await self.db.execute(
                select(ProductoVariante.sku_local, ProductoVariante.id).where(
                    and_(
                        ProductoVariante.supermercado_id == super_id,
                        ProductoVariante.sku_local.in_(skus),
                    )
                )
            )
            for sku_local, variante_id in result:
                existentes[(super_key, sku_local)] = variante_id

        return existentes

    # ── Procesamiento individual ─────────────────────────────
    async def _procesar_uno(self, raw: dict, skus_existentes: dict | None = None) -> str:
        """
        Flujo:
        1. Resolver supermercado_id
        2. Revisar caché pre-cargado; si no, buscar variante por SKU en BD
        3. Si no existe → product matching con IA para encontrar producto_id
        4. Si tampoco existe → crear producto nuevo
        5. Guardar precio actual
        """
        super_id = await self._get_supermercado_id(raw["supermercado_key"])
        if not super_id:
            raise ValueError(f"Supermercado desconocido: {raw['supermercado_key']}")

        # ── 1. Buscar variante (caché bulk o BD) ─────────────
        variante_id = (skus_existentes or {}).get((raw["supermercado_key"], raw["sku_local"]))

        if variante_id is None:
            variante = await self._buscar_variante(super_id, raw["sku_local"])
            variante_id = variante.id if variante else None

        if variante_id is not None:
            await self._guardar_precio(variante_id, raw)
            return "actualizado"

        # ── 2. Producto nuevo: intentar matching IA ──────────
        producto_id = await self._resolver_producto_id(raw)

        # ── 3. Crear variante ────────────────────────────────
        nueva_variante = ProductoVariante(
            producto_id=producto_id,
            supermercado_id=super_id,
            nombre_local=raw.get("nombre_local"),
            sku_local=raw.get("sku_local"),
            url_producto=raw.get("url_producto"),
        )
        self.db.add(nueva_variante)
        await self.db.flush()  # obtener nueva_variante.id sin commit

        # ── 4. Guardar precio ────────────────────────────────
        await self._guardar_precio(nueva_variante.id, raw)
        return "nuevo"

    # ── Resolución de producto_id ────────────────────────────
    async def _resolver_producto_id(self, raw: dict) -> int:
        """
        Intenta encontrar el producto normalizado en BD.
        Primero por EAN (exacto), luego por IA (semántico).
        Si no encuentra, crea uno nuevo.
        """
        # Por EAN (código de barras) — match exacto y gratuito
        if raw.get("ean"):
            producto = await self._buscar_por_ean(raw["ean"])
            if producto:
                logger.debug("Match por EAN", ean=raw["ean"], producto_id=producto.id)
                return producto.id

        # Por IA — product matching semántico
        candidatos = await self._buscar_candidatos(raw["nombre_local"], raw.get("marca"))
        if candidatos:
            match_id = await self.matching.encontrar_match(
                nombre_nuevo=raw["nombre_local"],
                marca=raw.get("marca") or "",
                candidatos=candidatos,
            )
            if match_id:
                logger.debug("Match por IA", nombre=raw["nombre_local"], match_id=match_id)
                return match_id

        # Sin match → crear producto normalizado nuevo
        return await self._crear_producto(raw)

    async def _crear_producto(self, raw: dict) -> int:
        """Crea un producto normalizado nuevo en la BD."""
        cat_id = await self._get_categoria_id(raw.get("categoria_nombre"))

        producto = Producto(
            nombre_normalizado=raw["nombre_local"],
            marca=raw.get("marca"),
            categoria_id=cat_id,
            descripcion=raw.get("descripcion"),
            imagen_url=raw.get("imagen_url"),
            ean=raw.get("ean"),
            unidad=self._inferir_unidad(raw["nombre_local"]),
            cantidad=self._inferir_cantidad(raw["nombre_local"]),
        )
        self.db.add(producto)
        await self.db.flush()
        return producto.id

    # ── Guardado de precio ───────────────────────────────────
    async def _guardar_precio(self, variante_id: int, raw: dict) -> None:
        """
        Guarda el precio actual SOLO si cambió respecto al último registrado.
        Evita duplicados innecesarios en el histórico.
        """
        ultimo = await self._ultimo_precio(variante_id)

        precio_normal = Decimal(str(raw["precio_normal"]))
        precio_oferta = (
            Decimal(str(raw["precio_oferta"])) if raw.get("precio_oferta") else None
        )

        # Si el precio no cambió, no guardamos (ahorra espacio en BD)
        if ultimo:
            mismo_normal = ultimo.precio_normal == precio_normal
            misma_oferta = ultimo.precio_oferta == precio_oferta
            if mismo_normal and misma_oferta:
                return

        precio = Precio(
            variante_id=variante_id,
            precio_normal=precio_normal,
            precio_oferta=precio_oferta,
            en_oferta=precio_oferta is not None,
            descuento_pct=raw.get("descuento_pct"),
            disponible=raw.get("disponible", True),
            condicion_oferta=raw.get("condicion_oferta"),
            fecha_hora=datetime.now(timezone.utc),
        )
        self.db.add(precio)

    # ── Helpers de BD ────────────────────────────────────────
    async def _buscar_variante(
        self, supermercado_id: int, sku_local: str
    ) -> Optional[ProductoVariante]:
        result = await self.db.execute(
            select(ProductoVariante).where(
                and_(
                    ProductoVariante.supermercado_id == supermercado_id,
                    ProductoVariante.sku_local == sku_local,
                )
            )
        )
        return result.scalar_one_or_none()

    async def _buscar_por_ean(self, ean: str) -> Optional[Producto]:
        result = await self.db.execute(
            select(Producto).where(Producto.ean == ean)
        )
        return result.scalar_one_or_none()

    async def _buscar_candidatos(
        self, nombre: str, marca: Optional[str]
    ) -> list[dict]:
        """
        Busca candidatos usando pg_trgm similarity — tolera variaciones de orden
        y escritura ("LALA Leche 1L" coincide con "Leche Entera LALA 1 Litro").
        Umbral 0.2 amplio a propósito; la IA decide el match final.
        """
        similitud = func.similarity(Producto.nombre_normalizado, nombre)
        stmt = (
            select(Producto)
            .where(similitud > 0.2)
            .order_by(similitud.desc())
            .limit(5)
        )
        if marca:
            stmt = stmt.where(Producto.marca.ilike(f"%{marca}%"))

        result = await self.db.execute(stmt)
        productos = result.scalars().all()
        return [
            {"id": p.id, "nombre": p.nombre_normalizado, "marca": p.marca or ""}
            for p in productos
        ]

    async def _ultimo_precio(self, variante_id: int) -> Optional[Precio]:
        result = await self.db.execute(
            select(Precio)
            .where(Precio.variante_id == variante_id)
            .order_by(Precio.fecha_hora.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _get_supermercado_id(self, key: str) -> Optional[int]:
        if key in self._cache_supermercados:
            return self._cache_supermercados[key]
        result = await self.db.execute(
            select(Supermercado).where(Supermercado.nombre_corto == key)
        )
        super_ = result.scalar_one_or_none()
        if super_:
            self._cache_supermercados[key] = super_.id
        return super_.id if super_ else None

    async def _get_categoria_id(self, nombre: Optional[str]) -> Optional[int]:
        if not nombre:
            return None
        nombre_lower = nombre.lower()
        if nombre_lower in self._cache_categorias:
            return self._cache_categorias[nombre_lower]
        result = await self.db.execute(
            select(Categoria).where(Categoria.nombre.ilike(f"%{nombre}%"))
        )
        cat = result.scalar_one_or_none()
        if cat:
            self._cache_categorias[nombre_lower] = cat.id
            return cat.id
        return None

    async def _actualizar_ejecucion(
        self, ejecucion_id: int, nuevos: int, actualizados: int, errores: int
    ) -> None:
        result = await self.db.execute(
            select(EjecucionScraper).where(EjecucionScraper.id == ejecucion_id)
        )
        ej = result.scalar_one_or_none()
        if ej:
            ej.fin = datetime.now(timezone.utc)
            ej.estado = "completado" if errores == 0 else "completado_con_errores"
            ej.productos_nuevos = nuevos
            ej.productos_actualizados = actualizados
            ej.errores = errores
            ej.productos_encontrados = nuevos + actualizados
            if ej.inicio:
                ej.duracion_segundos = int(
                    (ej.fin - ej.inicio).total_seconds()
                )

    # ── Inferencia de unidad y cantidad desde el nombre ──────
    @staticmethod
    def _inferir_unidad(nombre: str) -> Optional[str]:
        """Extrae la unidad desde el nombre del producto: '500g' → 'g'"""
        import re
        patrones = [
            (r"\b(\d+(?:\.\d+)?)\s*kg\b", "kg"),
            (r"\b(\d+(?:\.\d+)?)\s*g\b", "g"),
            (r"\b(\d+(?:\.\d+)?)\s*L\b", "L"),
            (r"\b(\d+(?:\.\d+)?)\s*ml\b", "ml"),
            (r"\b(\d+(?:\.\d+)?)\s*lt\b", "L"),
        ]
        nombre_lower = nombre.lower()
        for patron, unidad in patrones:
            if re.search(patron, nombre_lower, re.IGNORECASE):
                return unidad
        return "unidad"

    @staticmethod
    def _inferir_cantidad(nombre: str) -> Optional[Decimal]:
        """Extrae la cantidad desde el nombre: '500g' → 500"""
        import re
        patron = r"\b(\d+(?:\.\d+)?)\s*(?:kg|g|l|ml|lt)\b"
        m = re.search(patron, nombre, re.IGNORECASE)
        if m:
            return Decimal(m.group(1))
        return None

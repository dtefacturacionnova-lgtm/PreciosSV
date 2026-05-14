"""
app/api/v1/endpoints/proveedores.py
Endpoints B2B para proveedores y fabricantes.
Inteligencia competitiva: posición, cuota de mercado, alertas B2B.
"""
from typing import List, Optional
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import require_proveedor
from app.db.database import get_db
from app.models.models import (
    Producto, ProductoVariante, Precio, Supermercado,
    Proveedor, ProveedorMarca, AlertaB2B,
)

router = APIRouter(prefix="/proveedores", tags=["Proveedores B2B"])


def _get_proveedor_id(current_user: dict) -> int:
    """Extrae el proveedor_id del token JWT del usuario."""
    proveedor_id = current_user.get("proveedor_id")
    if not proveedor_id:
        raise HTTPException(403, "Usuario no asociado a un proveedor")
    return int(proveedor_id)


# ── Dashboard del proveedor ───────────────────────────────────
@router.get("/dashboard")
async def dashboard_proveedor(
    current_user: dict = Depends(require_proveedor),
    db: AsyncSession = Depends(get_db),
):
    """Resumen ejecutivo: mis productos, posición promedio, cuota de mercado."""
    proveedor_id = _get_proveedor_id(current_user)

    # Mis marcas propias
    result = await db.execute(
        select(ProveedorMarca)
        .where(
            and_(
                ProveedorMarca.proveedor_id == proveedor_id,
                ProveedorMarca.es_propia == True,
            )
        )
    )
    mis_marcas = [pm.marca for pm in result.scalars().all()]

    if not mis_marcas:
        return {"mensaje": "No tienes marcas configuradas. Agrega tus marcas en configuración."}

    # Mis productos en BD
    result = await db.execute(
        select(Producto)
        .where(Producto.marca.in_(mis_marcas))
        .options(
            selectinload(Producto.variantes).selectinload(ProductoVariante.supermercado),
            selectinload(Producto.variantes).selectinload(ProductoVariante.precios),
        )
    )
    mis_productos = result.scalars().all()

    # Estadísticas de posicionamiento
    resumen = await _calcular_posicionamiento(db, mis_productos, mis_marcas)

    return {
        "mis_marcas": mis_marcas,
        "total_productos": len(mis_productos),
        **resumen,
    }


# ── Mis productos con posición ────────────────────────────────
@router.get("/mis-productos")
async def mis_productos(
    current_user: dict = Depends(require_proveedor),
    db: AsyncSession = Depends(get_db),
):
    """Lista mis productos con precio actual y posición en cada cadena."""
    proveedor_id = _get_proveedor_id(current_user)

    result = await db.execute(
        select(ProveedorMarca)
        .where(
            and_(
                ProveedorMarca.proveedor_id == proveedor_id,
                ProveedorMarca.es_propia == True,
            )
        )
    )
    mis_marcas = [pm.marca for pm in result.scalars().all()]

    result = await db.execute(
        select(Producto)
        .where(Producto.marca.in_(mis_marcas))
        .options(
            selectinload(Producto.variantes)
            .selectinload(ProductoVariante.supermercado),
            selectinload(Producto.variantes)
            .selectinload(ProductoVariante.precios),
            selectinload(Producto.categoria),
        )
    )
    productos = result.scalars().all()

    output = []
    for p in productos:
        precios_por_cadena = {}
        for variante in p.variantes:
            if variante.precios:
                ultimo = variante.precios[0]
                precios_por_cadena[variante.supermercado.nombre_corto] = {
                    "precio_normal": float(ultimo.precio_normal),
                    "precio_oferta": float(ultimo.precio_oferta) if ultimo.precio_oferta else None,
                    "en_oferta": ultimo.en_oferta,
                    "supermercado_nombre": variante.supermercado.nombre,
                }

        # Posición: ranking de menor a mayor precio efectivo
        todos_precios = [
            v["precio_oferta"] or v["precio_normal"]
            for v in precios_por_cadena.values()
        ]
        todos_precios.sort()

        # Precio de mi producto en cualquier cadena donde aparezca primero
        mi_precio_efectivo = min(todos_precios) if todos_precios else None
        posicion = (todos_precios.index(mi_precio_efectivo) + 1) if mi_precio_efectivo else None

        output.append({
            "id": p.id,
            "nombre": p.nombre_normalizado,
            "marca": p.marca,
            "imagen_url": p.imagen_url,
            "unidad": p.unidad,
            "cantidad": p.cantidad,
            "categoria": p.categoria.nombre if p.categoria else None,
            "precios_por_cadena": precios_por_cadena,
            "posicion_precio": posicion,
            "precio_min_mercado": min(todos_precios) if todos_precios else None,
            "precio_max_mercado": max(todos_precios) if todos_precios else None,
        })

    return output


# ── Comparativa con competidores ──────────────────────────────
@router.get("/competencia/{categoria_id}")
async def comparativa_competencia(
    categoria_id: int,
    current_user: dict = Depends(require_proveedor),
    db: AsyncSession = Depends(get_db),
):
    """
    Compara mis productos vs competidores en la misma categoría.
    Muestra precio promedio, posición y participación de mercado por marca.
    """
    proveedor_id = _get_proveedor_id(current_user)

    # Traer todos los productos de la categoría con precios
    result = await db.execute(
        select(
            Producto.marca,
            func.avg(
                func.coalesce(Precio.precio_oferta, Precio.precio_normal)
            ).label("precio_promedio"),
            func.count(Producto.id.distinct()).label("num_productos"),
            func.sum(
                func.cast(Precio.en_oferta, func.Integer())
            ).label("en_oferta_count"),
        )
        .join(Producto.variantes)
        .join(ProductoVariante.precios)
        .where(Producto.categoria_id == categoria_id)
        .group_by(Producto.marca)
        .order_by(func.avg(
            func.coalesce(Precio.precio_oferta, Precio.precio_normal)
        ))
    )
    rows = result.mappings().all()

    total_productos = sum(r["num_productos"] for r in rows)

    return [
        {
            "marca": r["marca"] or "Sin marca",
            "precio_promedio": round(float(r["precio_promedio"]), 2),
            "num_productos": r["num_productos"],
            "en_oferta_count": r["en_oferta_count"] or 0,
            "cuota_mercado_pct": round(r["num_productos"] / total_productos * 100, 1)
            if total_productos else 0,
        }
        for r in rows
    ]


# ── Alertas B2B ───────────────────────────────────────────────
@router.get("/alertas-b2b")
async def mis_alertas_b2b(
    current_user: dict = Depends(require_proveedor),
    db: AsyncSession = Depends(get_db),
):
    """Lista las alertas B2B configuradas por este proveedor."""
    proveedor_id = _get_proveedor_id(current_user)
    result = await db.execute(
        select(AlertaB2B)
        .where(AlertaB2B.proveedor_id == proveedor_id)
        .order_by(desc(AlertaB2B.created_at))
    )
    return result.scalars().all()


@router.post("/alertas-b2b", status_code=201)
async def crear_alerta_b2b(
    tipo: str,
    marca_competidor: Optional[str] = None,
    supermercado_id: Optional[int] = None,
    umbral_descuento_pct: Optional[float] = None,
    current_user: dict = Depends(require_proveedor),
    db: AsyncSession = Depends(get_db),
):
    """
    Crea una alerta B2B.
    Tipos: oferta_competencia | precio_minimo | posicion_perdida | sin_stock_competidor
    """
    tipos_validos = [
        "oferta_competencia", "precio_minimo",
        "posicion_perdida", "sin_stock_competidor",
    ]
    if tipo not in tipos_validos:
        raise HTTPException(400, f"Tipo inválido. Opciones: {tipos_validos}")

    proveedor_id = _get_proveedor_id(current_user)
    alerta = AlertaB2B(
        proveedor_id=proveedor_id,
        tipo=tipo,
        marca_competidor=marca_competidor,
        supermercado_id=supermercado_id,
        umbral_descuento_pct=Decimal(str(umbral_descuento_pct)) if umbral_descuento_pct else None,
    )
    db.add(alerta)
    await db.flush()
    return {"id": alerta.id, "tipo": alerta.tipo, "activa": alerta.activa}


# ── Oferta activa de competidores ─────────────────────────────
@router.get("/competencia/ofertas-activas")
async def ofertas_competencia(
    current_user: dict = Depends(require_proveedor),
    db: AsyncSession = Depends(get_db),
):
    """
    Muestra qué productos de marcas competidoras están en oferta ahora.
    """
    proveedor_id = _get_proveedor_id(current_user)

    # Marcas a monitorear (competencia)
    result = await db.execute(
        select(ProveedorMarca)
        .where(
            and_(
                ProveedorMarca.proveedor_id == proveedor_id,
                ProveedorMarca.es_propia == False,
            )
        )
    )
    marcas_comp = [pm.marca for pm in result.scalars().all()]

    if not marcas_comp:
        return []

    result = await db.execute(
        select(
            Producto.nombre_normalizado,
            Producto.marca,
            Precio.precio_normal,
            Precio.precio_oferta,
            Precio.descuento_pct,
            Precio.condicion_oferta,
            Supermercado.nombre.label("supermercado"),
        )
        .join(Producto.variantes)
        .join(ProductoVariante.precios)
        .join(ProductoVariante.supermercado)
        .where(
            and_(
                Producto.marca.in_(marcas_comp),
                Precio.en_oferta == True,
            )
        )
        .order_by(desc(Precio.descuento_pct))
    )
    return [dict(r) for r in result.mappings().all()]


# ── Helper ────────────────────────────────────────────────────
async def _calcular_posicionamiento(
    db: AsyncSession,
    mis_productos: list,
    mis_marcas: list[str],
) -> dict:
    """Calcula métricas de posicionamiento promedio."""
    posiciones = []
    en_oferta = 0

    for producto in mis_productos:
        precios_todos = []
        for variante in producto.variantes:
            if variante.precios:
                p = variante.precios[0]
                precio_ef = float(p.precio_oferta or p.precio_normal)
                precios_todos.append(precio_ef)
                if p.en_oferta:
                    en_oferta += 1

        if precios_todos:
            mi_precio = min(precios_todos)
            sorted_p = sorted(precios_todos)
            pos = sorted_p.index(mi_precio) + 1
            posiciones.append(pos)

    return {
        "posicion_promedio": round(sum(posiciones) / len(posiciones), 1) if posiciones else None,
        "productos_en_oferta": en_oferta,
        "cadenas_con_presencia": len({
            v.supermercado_id
            for p in mis_productos
            for v in p.variantes
        }),
    }

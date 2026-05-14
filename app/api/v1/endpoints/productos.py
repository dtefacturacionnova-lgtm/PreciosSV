"""
app/api/v1/endpoints/productos.py
Endpoints públicos y autenticados para productos, precios y comparativas.
"""
from typing import Optional, List
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select, func, and_, desc, over
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.models.models import (
    Producto, ProductoVariante, Precio, Supermercado,
    Categoria, AlertaUsuario,
)
from app.schemas.schemas import (
    ProductoResumen, ProductoComparativa, PrecioHistoricoOut,
    AlertaCreate, AlertaOut, PaginatedResponse,
)
from app.core.security import get_current_user

router = APIRouter(prefix="/productos", tags=["Productos"])


# ── GET /productos ────────────────────────────────────────────
@router.get("", response_model=PaginatedResponse)
async def listar_productos(
    q: Optional[str] = Query(None, description="Búsqueda por nombre o marca"),
    categoria_id: Optional[int] = Query(None),
    supermercado_id: Optional[int] = Query(None),
    solo_ofertas: bool = Query(False, description="Solo productos en oferta"),
    orden: str = Query("nombre", enum=["nombre", "precio_asc", "precio_desc"]),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """
    Lista productos con filtros opcionales.
    Incluye precio mínimo actual y supermercado más barato.
    """
    stmt = select(Producto)

    # Filtros
    if q:
        stmt = stmt.where(
            Producto.nombre_normalizado.ilike(f"%{q}%") |
            Producto.marca.ilike(f"%{q}%")
        )
    if categoria_id:
        stmt = stmt.where(Producto.categoria_id == categoria_id)

    # Contar total
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar_one()

    # Ordenar
    if orden == "nombre":
        stmt = stmt.order_by(Producto.nombre_normalizado)
    # precio_asc/desc requiere subquery — se simplifica para el MVP

    # Paginar
    offset = (page - 1) * page_size
    stmt = stmt.offset(offset).limit(page_size)
    stmt = stmt.options(selectinload(Producto.categoria))

    result = await db.execute(stmt)
    productos = result.scalars().all()

    if not productos:
        return PaginatedResponse(items=[], total=total, page=page, page_size=page_size, pages=0)

    # Una sola query para min/max precios de todos los productos de la página
    producto_ids = [p.id for p in productos]
    prices_stmt = (
        select(
            ProductoVariante.producto_id,
            func.min(func.coalesce(Precio.precio_oferta, Precio.precio_normal)).label("precio_min"),
            func.max(Precio.precio_normal).label("precio_max"),
            func.bool_or(Precio.en_oferta).label("tiene_oferta"),
        )
        .join(Precio, Precio.variante_id == ProductoVariante.id)
        .where(ProductoVariante.producto_id.in_(producto_ids))
        .group_by(ProductoVariante.producto_id)
    )
    prices_result = await db.execute(prices_stmt)
    prices_map = {row.producto_id: row for row in prices_result.mappings()}

    items = []
    for p in productos:
        row = prices_map.get(p.id)
        if solo_ofertas and (not row or not row.tiene_oferta):
            continue
        items.append({
            "id": p.id,
            "nombre_normalizado": p.nombre_normalizado,
            "marca": p.marca,
            "imagen_url": p.imagen_url,
            "unidad": p.unidad,
            "cantidad": p.cantidad,
            "categoria": p.categoria,
            "precio_min": row.precio_min if row else None,
            "precio_max": row.precio_max if row else None,
        })

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        pages=0,  # calculado por validator
    )


# ── GET /productos/{id}/comparativa ──────────────────────────
@router.get("/{producto_id}/comparativa", response_model=ProductoComparativa)
async def comparativa_producto(
    producto_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Retorna el precio actual de un producto en TODOS los supermercados.
    Este es el endpoint estrella de PrecioSV.
    """
    result = await db.execute(
        select(Producto)
        .where(Producto.id == producto_id)
        .options(
            selectinload(Producto.categoria),
            selectinload(Producto.variantes).selectinload(ProductoVariante.supermercado),
            selectinload(Producto.variantes).selectinload(ProductoVariante.precios),
        )
    )
    producto = result.scalar_one_or_none()
    if not producto:
        raise HTTPException(404, "Producto no encontrado")

    precios_actuales = []
    for variante in producto.variantes:
        if not variante.activo or not variante.precios:
            continue
        # selectinload no garantiza orden — ordenar explícitamente
        precio = max(variante.precios, key=lambda p: p.fecha_hora)
        precios_actuales.append({
            "precio_normal": precio.precio_normal,
            "precio_oferta": precio.precio_oferta,
            "en_oferta": precio.en_oferta,
            "descuento_pct": precio.descuento_pct,
            "disponible": precio.disponible,
            "condicion_oferta": precio.condicion_oferta,
            "fecha_hora": precio.fecha_hora,
            "supermercado": variante.supermercado,
        })

    return {
        "id": producto.id,
        "nombre_normalizado": producto.nombre_normalizado,
        "marca": producto.marca,
        "descripcion": producto.descripcion,
        "imagen_url": producto.imagen_url,
        "ean": producto.ean,
        "unidad": producto.unidad,
        "cantidad": producto.cantidad,
        "categoria": producto.categoria,
        "precios_actuales": precios_actuales,
    }


# ── GET /productos/{id}/historico ─────────────────────────────
@router.get("/{producto_id}/historico", response_model=List[dict])
async def historico_producto(
    producto_id: int,
    supermercado_id: Optional[int] = Query(None, description="Filtrar por supermercado"),
    dias: int = Query(30, ge=7, le=365, description="Días hacia atrás"),
    db: AsyncSession = Depends(get_db),
):
    """
    Histórico de precios de un producto.
    Ideal para las gráficas de evolución en el dashboard.
    """
    from datetime import timedelta
    from datetime import datetime, timezone

    desde = datetime.now(timezone.utc) - timedelta(days=dias)

    stmt = (
        select(
            Precio.fecha_hora,
            Precio.precio_normal,
            Precio.precio_oferta,
            Precio.en_oferta,
            Supermercado.nombre_corto.label("supermercado"),
        )
        .join(Precio.variante)
        .join(ProductoVariante.supermercado)
        .where(
            and_(
                ProductoVariante.producto_id == producto_id,
                Precio.fecha_hora >= desde,
            )
        )
        .order_by(Precio.fecha_hora)
    )

    if supermercado_id:
        stmt = stmt.where(ProductoVariante.supermercado_id == supermercado_id)

    result = await db.execute(stmt)
    rows = result.mappings().all()

    return [dict(row) for row in rows]


# ── GET /productos/ean/{ean} ──────────────────────────────────
@router.get("/ean/{ean}", response_model=ProductoComparativa)
async def buscar_por_ean(
    ean: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Busca un producto por código de barras.
    Usado por el escáner de la app móvil.
    """
    result = await db.execute(
        select(Producto).where(Producto.ean == ean)
    )
    producto = result.scalar_one_or_none()
    if not producto:
        raise HTTPException(404, f"Producto con EAN {ean} no encontrado")

    # Reusar endpoint de comparativa
    return await comparativa_producto(producto.id, db)


# ── GET /productos/ofertas ────────────────────────────────────
@router.get("/ofertas/activas", response_model=List[dict])
async def ofertas_activas(
    categoria_id: Optional[int] = Query(None),
    supermercado_id: Optional[int] = Query(None),
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
):
    """
    Lista de productos actualmente en oferta, ordenados por mayor descuento.
    """
    # Subquery: precio más reciente por variante usando row_number()
    # Evita mostrar ofertas que ya expiraron pero siguen en el historial
    precio_rn = (
        select(
            Precio.variante_id,
            Precio.precio_normal,
            Precio.precio_oferta,
            Precio.en_oferta,
            Precio.descuento_pct,
            Precio.condicion_oferta,
            func.row_number().over(
                partition_by=Precio.variante_id,
                order_by=Precio.fecha_hora.desc(),
            ).label("rn"),
        )
    ).subquery("precio_rn")

    stmt = (
        select(
            Producto.id,
            Producto.nombre_normalizado,
            Producto.marca,
            Producto.imagen_url,
            precio_rn.c.precio_normal,
            precio_rn.c.precio_oferta,
            precio_rn.c.descuento_pct,
            precio_rn.c.condicion_oferta,
            Supermercado.nombre.label("supermercado_nombre"),
            Supermercado.nombre_corto.label("supermercado_key"),
        )
        .join(ProductoVariante, ProductoVariante.producto_id == Producto.id)
        .join(
            precio_rn,
            and_(
                precio_rn.c.variante_id == ProductoVariante.id,
                precio_rn.c.rn == 1,
                precio_rn.c.en_oferta == True,
            ),
        )
        .join(Supermercado, Supermercado.id == ProductoVariante.supermercado_id)
        .order_by(desc(precio_rn.c.descuento_pct))
        .limit(limit)
    )

    if supermercado_id:
        stmt = stmt.where(ProductoVariante.supermercado_id == supermercado_id)
    if categoria_id:
        stmt = stmt.where(Producto.categoria_id == categoria_id)

    result = await db.execute(stmt)
    return [dict(row) for row in result.mappings().all()]


# ── POST /productos/alertas ───────────────────────────────────
@router.post("/alertas", response_model=AlertaOut, status_code=201)
async def crear_alerta(
    payload: AlertaCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Crea una alerta de precio para el usuario autenticado."""
    # Verificar que el producto existe
    result = await db.execute(
        select(Producto).where(Producto.id == payload.producto_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Producto no encontrado")

    # Evitar duplicados
    existente = await db.execute(
        select(AlertaUsuario).where(
            and_(
                AlertaUsuario.usuario_id == int(current_user["sub"]),
                AlertaUsuario.producto_id == payload.producto_id,
                AlertaUsuario.activa == True,
            )
        )
    )
    if existente.scalar_one_or_none():
        raise HTTPException(409, "Ya tienes una alerta activa para este producto")

    alerta = AlertaUsuario(
        usuario_id=int(current_user["sub"]),
        producto_id=payload.producto_id,
        precio_objetivo=payload.precio_objetivo,
        supermercado_id=payload.supermercado_id,
    )
    db.add(alerta)
    await db.flush()

    return alerta


# ── GET /productos/alertas/mis-alertas ────────────────────────
@router.get("/alertas/mis-alertas", response_model=List[AlertaOut])
async def mis_alertas(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista las alertas activas del usuario autenticado."""
    result = await db.execute(
        select(AlertaUsuario)
        .where(
            and_(
                AlertaUsuario.usuario_id == int(current_user["sub"]),
                AlertaUsuario.activa == True,
            )
        )
        .options(
            selectinload(AlertaUsuario.producto).selectinload(Producto.categoria)
        )
        .order_by(desc(AlertaUsuario.created_at))
    )
    return result.scalars().all()



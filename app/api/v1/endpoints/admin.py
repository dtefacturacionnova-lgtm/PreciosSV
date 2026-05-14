"""
app/api/v1/endpoints/admin.py
Endpoints exclusivos del rol administrador.
Control de scrapers, estadísticas del sistema, gestión de usuarios.
"""
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import require_admin
from app.db.database import get_db
from app.models.models import (
    EjecucionScraper, Supermercado, Usuario, Producto,
    AlertaUsuario, Proveedor,
)
from app.schemas.schemas import EjecucionOut, ResumenAdmin, UsuarioOut

router = APIRouter(prefix="/admin", tags=["Administración"])


# ── Dashboard: resumen general ────────────────────────────────
@router.get("/resumen", response_model=ResumenAdmin)
async def resumen_sistema(
    _: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Métricas generales del sistema para el dashboard de admin."""

    total_productos = (await db.execute(select(func.count(Producto.id)))).scalar_one()
    total_supers = (await db.execute(select(func.count(Supermercado.id)))).scalar_one()
    total_usuarios = (await db.execute(select(func.count(Usuario.id)))).scalar_one()
    total_proveedores = (await db.execute(select(func.count(Proveedor.id)))).scalar_one()
    alertas_activas = (await db.execute(
        select(func.count(AlertaUsuario.id)).where(AlertaUsuario.activa == True)
    )).scalar_one()

    # Último scrape exitoso
    last_scrape = (await db.execute(
        select(EjecucionScraper.fin)
        .where(EjecucionScraper.estado == "completado")
        .order_by(desc(EjecucionScraper.fin))
        .limit(1)
    )).scalar_one_or_none()

    # Uptime: % de ejecuciones completadas vs total (últimos 30 días)
    total_ej = (await db.execute(select(func.count(EjecucionScraper.id)))).scalar_one()
    ok_ej = (await db.execute(
        select(func.count(EjecucionScraper.id))
        .where(EjecucionScraper.estado.in_(["completado", "completado_con_errores"]))
    )).scalar_one()

    uptime = round((ok_ej / total_ej * 100), 1) if total_ej else 100.0

    return ResumenAdmin(
        total_productos=total_productos,
        total_supermercados=total_supers,
        total_usuarios=total_usuarios,
        total_proveedores=total_proveedores,
        alertas_activas=alertas_activas,
        ultimo_scrape=last_scrape,
        uptime_scrapers=uptime,
    )


# ── Scrapers: estado y control ────────────────────────────────
@router.get("/scrapers/estado", response_model=List[dict])
async def estado_scrapers(
    _: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Estado actual de cada scraper: última ejecución, duración, errores."""
    result = await db.execute(
        select(Supermercado)
        .where(Supermercado.activo == True)
        .options(selectinload(Supermercado.ejecuciones))
    )
    supermercados = result.scalars().all()

    estados = []
    for s in supermercados:
        ejecuciones = sorted(s.ejecuciones, key=lambda e: e.inicio, reverse=True)
        ultima = ejecuciones[0] if ejecuciones else None

        estados.append({
            "supermercado_id": s.id,
            "nombre": s.nombre,
            "nombre_corto": s.nombre_corto,
            "ultima_ejecucion": ultima.fin if ultima else None,
            "estado": ultima.estado if ultima else "nunca_ejecutado",
            "productos_encontrados": ultima.productos_encontrados if ultima else 0,
            "duracion_segundos": ultima.duracion_segundos if ultima else None,
            "errores": ultima.errores if ultima else 0,
        })

    return estados


@router.post("/scrapers/{supermercado_key}/ejecutar", status_code=202)
async def ejecutar_scraper(
    supermercado_key: str,
    _: dict = Depends(require_admin),
):
    """
    Dispara manualmente el scraper de un supermercado.
    Retorna 202 Accepted — el scrape corre en background via Celery.
    """
    from app.tasks.scraper_tasks import scrape_supermercado

    supermercados_validos = ["selectos", "walmart", "donjuan", "maxidespensa", "familiar"]
    if supermercado_key not in supermercados_validos:
        raise HTTPException(400, f"Supermercado no válido. Opciones: {supermercados_validos}")

    task = scrape_supermercado.apply_async(args=[supermercado_key], queue="scrapers")
    return {"message": "Scraper encolado", "task_id": task.id, "supermercado": supermercado_key}


@router.get("/scrapers/logs", response_model=List[EjecucionOut])
async def logs_scrapers(
    limit: int = 50,
    supermercado_id: int | None = None,
    _: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Historial de ejecuciones de scrapers."""
    stmt = (
        select(EjecucionScraper)
        .options(selectinload(EjecucionScraper.supermercado))
        .order_by(desc(EjecucionScraper.inicio))
        .limit(limit)
    )
    if supermercado_id:
        stmt = stmt.where(EjecucionScraper.supermercado_id == supermercado_id)

    result = await db.execute(stmt)
    return result.scalars().all()


# ── Usuarios ─────────────────────────────────────────────────
@router.get("/usuarios", response_model=List[UsuarioOut])
async def listar_usuarios(
    page: int = 1,
    page_size: int = 50,
    _: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Lista paginada de todos los usuarios."""
    result = await db.execute(
        select(Usuario)
        .order_by(desc(Usuario.created_at))
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return result.scalars().all()


@router.patch("/usuarios/{usuario_id}/activar")
async def activar_usuario(
    usuario_id: int,
    activo: bool,
    _: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Activa o desactiva una cuenta de usuario."""
    result = await db.execute(select(Usuario).where(Usuario.id == usuario_id))
    usuario = result.scalar_one_or_none()
    if not usuario:
        raise HTTPException(404, "Usuario no encontrado")
    usuario.activo = activo
    return {"message": f"Usuario {'activado' if activo else 'desactivado'}", "id": usuario_id}


# ── Analíticas de inflación ───────────────────────────────────
@router.get("/inflacion/indice")
async def indice_inflacion(
    meses: int = 6,
    _: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Calcula el índice de inflación PrecioSV basado en precios reales de góndola.
    Compara el precio promedio de la canasta de productos monitoreados
    mes a mes.
    """
    from sqlalchemy import text
    sql = text("""
        SELECT
            DATE_TRUNC('month', p.fecha_hora) AS mes,
            AVG(p.precio_normal)              AS precio_promedio,
            COUNT(DISTINCT pv.producto_id)    AS productos_en_canasta
        FROM precios p
        JOIN producto_variantes pv ON p.variante_id = pv.id
        WHERE p.fecha_hora >= NOW() - INTERVAL ':meses months'
        GROUP BY DATE_TRUNC('month', p.fecha_hora)
        ORDER BY mes
    """)
    result = await db.execute(sql, {"meses": meses})
    rows = result.mappings().all()

    # Calcular variación mensual
    datos = [dict(r) for r in rows]
    for i in range(1, len(datos)):
        ant = float(datos[i - 1]["precio_promedio"])
        act = float(datos[i]["precio_promedio"])
        datos[i]["variacion_pct"] = round((act - ant) / ant * 100, 2) if ant else 0

    return datos

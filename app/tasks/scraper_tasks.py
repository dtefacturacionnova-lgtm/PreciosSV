"""
app/tasks/scraper_tasks.py
Tareas Celery para ejecución periódica de scrapers y alertas.
El scheduler (Celery Beat) las ejecuta automáticamente cada 6 horas.
"""
import asyncio
from datetime import datetime, timezone

from celery import Celery
from celery.schedules import crontab
from celery.utils.log import get_task_logger

from app.core.config import settings

logger = get_task_logger(__name__)

# ── Instancia Celery ─────────────────────────────────────────
celery_app = Celery(
    "preciosv",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["app.tasks.scraper_tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="America/El_Salvador",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,                    # reencolar si el worker muere
    worker_prefetch_multiplier=1,           # un job a la vez por worker
    task_routes={
        "app.tasks.scraper_tasks.scrape_supermercado": {"queue": "scrapers"},
        "app.tasks.scraper_tasks.evaluar_alertas":     {"queue": "alertas"},
    },
)

# ── Programación automática (Celery Beat) ────────────────────
celery_app.conf.beat_schedule = {
    # Scrape completo cada 6 horas: 0:00, 6:00, 12:00, 18:00
    "scrape-completo-cada-6h": {
        "task": "app.tasks.scraper_tasks.scrape_todos",
        "schedule": crontab(minute=0, hour="*/6"),
    },
    # Evaluar alertas 10 minutos después de cada scrape
    "evaluar-alertas-cada-6h": {
        "task": "app.tasks.scraper_tasks.evaluar_alertas",
        "schedule": crontab(minute=10, hour="*/6"),
    },
}


# ── Helpers async ────────────────────────────────────────────
def run_async(coro):
    """Ejecuta una corrutina async desde una tarea Celery síncrona."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── TAREA: scrape de todos los supermercados ─────────────────
@celery_app.task(
    name="app.tasks.scraper_tasks.scrape_todos",
    bind=True,
    max_retries=2,
    default_retry_delay=300,   # 5 min antes de reintentar
)
def scrape_todos(self):
    """
    Tarea principal: ejecuta todos los scrapers en secuencia.
    Celery no soporta async nativamente → usamos run_async().
    """
    logger.info("Iniciando ciclo completo de scraping")
    resultados = {}

    # Scrapers a ejecutar (en orden de prioridad)
    supermercados = ["selectos", "walmart", "donjuan", "maxidespensa", "familiar"]

    for super_key in supermercados:
        try:
            resultado = scrape_supermercado.apply_async(
                args=[super_key],
                queue="scrapers",
            )
            resultados[super_key] = resultado.id
            logger.info("Tarea de scraping encolada", super_key=super_key)
        except Exception as e:
            logger.error("Error encolando scraper", super_key=super_key, error=str(e))

    return resultados


@celery_app.task(
    name="app.tasks.scraper_tasks.scrape_supermercado",
    bind=True,
    max_retries=3,
    default_retry_delay=120,   # 2 min entre reintentos
)
def scrape_supermercado(self, supermercado_key: str):
    """
    Scrape de un supermercado individual.
    Registra la ejecución en BD y procesa los productos.
    """
    logger.info("Iniciando scrape", supermercado=supermercado_key)

    try:
        return run_async(_ejecutar_scrape(supermercado_key))
    except Exception as exc:
        logger.error("Scrape fallido", supermercado=supermercado_key, error=str(exc))
        raise self.retry(exc=exc)


async def _ejecutar_scrape(supermercado_key: str) -> dict:
    """Lógica async del scrape: BD + scraper + procesamiento."""
    from app.db.database import AsyncSessionLocal
    from app.models.models import EjecucionScraper, Supermercado
    from app.services.producto_service import ProductoService
    from app.scrapers.vtex import ScraperVTEX
    from app.scrapers.selectos import ScraperSelectos
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        # 1. Registrar inicio de ejecución
        result = await db.execute(
            select(Supermercado).where(Supermercado.nombre_corto == supermercado_key)
        )
        supermercado = result.scalar_one_or_none()
        if not supermercado:
            raise ValueError(f"Supermercado no encontrado: {supermercado_key}")

        ejecucion = EjecucionScraper(
            supermercado_id=supermercado.id,
            inicio=datetime.now(timezone.utc),
            estado="en_progreso",
        )
        db.add(ejecucion)
        await db.flush()
        ejecucion_id = ejecucion.id

        # 2. Ejecutar el scraper correspondiente
        try:
            if supermercado_key == "selectos":
                scraper = ScraperSelectos()
            else:
                scraper = ScraperVTEX(supermercado_key)

            productos_raw = await scraper.scrape()

        except Exception as e:
            ejecucion.estado = "error"
            ejecucion.mensaje_error = str(e)
            ejecucion.fin = datetime.now(timezone.utc)
            await db.commit()
            raise

        # 3. Procesar y guardar en BD
        service = ProductoService(db)
        resumen = await service.procesar_lote(productos_raw, ejecucion_id)
        await db.commit()

        logger.info("Scrape completado y guardado",
                    supermercado=supermercado_key, **resumen)
        return resumen


# ── TAREA: evaluar alertas de precio ─────────────────────────
@celery_app.task(
    name="app.tasks.scraper_tasks.evaluar_alertas",
    bind=True,
)
def evaluar_alertas(self):
    """
    Evalúa todas las alertas activas de usuarios.
    Envía emails cuando se cumple la condición de precio.
    """
    logger.info("Evaluando alertas de precio")
    return run_async(_evaluar_alertas_async())


async def _evaluar_alertas_async() -> dict:
    from app.db.database import AsyncSessionLocal
    from app.services.alerta_service import AlertaService

    async with AsyncSessionLocal() as db:
        service = AlertaService(db)
        resultado = await service.evaluar_todas()
        await db.commit()
        return resultado

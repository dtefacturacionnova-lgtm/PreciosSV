"""
app/main.py
Punto de entrada de la aplicación FastAPI.
Registra todos los routers, middleware y eventos de startup/shutdown.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.logging import setup_logging, get_logger
from app.db.database import engine, close_redis
from app.db.database import Base

# Routers
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.productos import router as productos_router
from app.api.v1.endpoints.admin import router as admin_router
from app.api.v1.endpoints.proveedores import router as proveedores_router

logger = get_logger(__name__)


# ── Lifespan: startup & shutdown ─────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Ejecuta lógica de inicio y cierre de la aplicación."""
    setup_logging()
    logger.info(
        "PrecioSV iniciando",
        version=settings.app_version,
        entorno=settings.app_env,
    )

    # Crear tablas si no existen (en producción usar Alembic)
    if settings.debug:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Tablas de BD verificadas")

    yield  # ← aplicación corriendo

    # Shutdown
    await close_redis()
    await engine.dispose()
    logger.info("PrecioSV apagado correctamente")


# ── Instancia FastAPI ─────────────────────────────────────────
app = FastAPI(
    title="PrecioSV API",
    description=(
        "API del sistema de monitoreo comparativo de precios de supermercados "
        "en El Salvador. Incluye endpoints para usuarios, proveedores/fabricantes "
        "y administradores del sistema."
    ),
    version=settings.app_version,
    lifespan=lifespan,
    docs_url="/docs",           # Swagger UI
    redoc_url="/redoc",         # ReDoc
    openapi_url="/openapi.json",
)


# ── CORS ──────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routers ───────────────────────────────────────────────────
API_PREFIX = "/api/v1"

app.include_router(auth_router,        prefix=API_PREFIX)
app.include_router(productos_router,   prefix=API_PREFIX)
app.include_router(admin_router,       prefix=API_PREFIX)
app.include_router(proveedores_router, prefix=API_PREFIX)


# ── Health check ──────────────────────────────────────────────
@app.get("/health", tags=["Sistema"])
async def health_check():
    return {
        "status": "ok",
        "version": settings.app_version,
        "entorno": settings.app_env,
    }


@app.get("/", tags=["Sistema"])
async def raiz():
    return {
        "app": "PrecioSV API",
        "version": settings.app_version,
        "docs": "/docs",
        "health": "/health",
    }


# ── Manejador global de errores ───────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error("Error no manejado", error=str(exc), path=str(request.url))
    return JSONResponse(
        status_code=500,
        content={"detail": "Error interno del servidor"},
    )

"""
app/core/logging.py
Logging estructurado con structlog.
Produce JSON en producción, texto legible en desarrollo.
"""
import logging
import structlog
from app.core.config import settings


def setup_logging() -> None:
    log_level = logging.DEBUG if settings.debug else logging.INFO

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]

    if settings.is_production:
        # JSON en producción (para ingestión en Datadog, Loki, etc.)
        processors = shared_processors + [structlog.processors.JSONRenderer()]
    else:
        # Texto colorido en desarrollo
        processors = shared_processors + [structlog.dev.ConsoleRenderer()]

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    logging.basicConfig(
        format="%(message)s",
        level=log_level,
    )


def get_logger(name: str):
    return structlog.get_logger(name)

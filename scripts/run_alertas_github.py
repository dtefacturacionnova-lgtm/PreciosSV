"""
Script standalone para evaluar alertas de precio sin Celery.
Usado por GitHub Actions.
"""
import asyncio
import sys
import os
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


async def main():
    from app.db.database import AsyncSessionLocal
    from app.services.alerta_service import AlertaService

    print(f"\n=== PreciosSV Alertas — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} ===")

    async with AsyncSessionLocal() as db:
        service = AlertaService(db)
        resultado = await service.evaluar_todas()
        await db.commit()

    print(f"  ✓ Alertas evaluadas: {resultado}")


if __name__ == "__main__":
    asyncio.run(main())

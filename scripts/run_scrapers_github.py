"""
Script standalone para ejecutar scrapers sin Celery/Redis.
Usado por GitHub Actions — corre directamente con asyncio.
"""
import asyncio
import sys
import os
from datetime import datetime, timezone

# Asegurar que el root del proyecto esté en el path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SUPERMERCADOS = ["selectos", "walmart", "donjuan", "maxidespensa", "familiar"]


async def run_scrape(supermercado_key: str) -> dict:
    from app.tasks.scraper_tasks import _ejecutar_scrape
    inicio = datetime.now(timezone.utc)
    print(f"\n[{inicio.strftime('%H:%M:%S')}] Iniciando: {supermercado_key}")
    try:
        resultado = await _ejecutar_scrape(supermercado_key)
        dur = (datetime.now(timezone.utc) - inicio).seconds
        print(f"  ✓ {supermercado_key}: {resultado} ({dur}s)")
        return {"status": "ok", "supermercado": supermercado_key, **resultado}
    except Exception as e:
        print(f"  ✗ {supermercado_key}: {e}")
        return {"status": "error", "supermercado": supermercado_key, "error": str(e)}


async def refrescar_vista():
    from app.db.database import AsyncSessionLocal
    from sqlalchemy import text
    async with AsyncSessionLocal() as db:
        await db.execute(text("SELECT refrescar_precios_actuales()"))
        await db.commit()
    print("\n  ✓ Vista materializada refrescada")


async def main():
    keys = sys.argv[1:] if len(sys.argv) > 1 else SUPERMERCADOS
    print(f"\n=== PreciosSV Scraper — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} ===")
    print(f"Supermercados: {', '.join(keys)}\n")

    resultados = []
    for key in keys:
        res = await run_scrape(key)
        resultados.append(res)

    await refrescar_vista()

    # Resumen
    ok    = [r for r in resultados if r["status"] == "ok"]
    error = [r for r in resultados if r["status"] == "error"]
    print(f"\n=== Resumen: {len(ok)}/{len(resultados)} exitosos ===")
    if error:
        print(f"Fallos: {', '.join(r['supermercado'] for r in error)}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

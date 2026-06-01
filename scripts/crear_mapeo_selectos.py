"""
Crea la tabla mapeo_selectos en Supabase via Management API.
Usar: python scripts/crear_mapeo_selectos.py
"""
import httpx, os, sys
from pathlib import Path

# Leer .env.local
env = {}
env_file = Path(__file__).parent.parent / 'web' / '.env.local'
with open(env_file) as f:
    for line in f:
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip()

URL = env['NEXT_PUBLIC_SUPABASE_URL']
KEY = env['SUPABASE_SERVICE_ROLE_KEY']
H = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}

SQL = """
CREATE TABLE IF NOT EXISTS mapeo_selectos (
  id            BIGSERIAL PRIMARY KEY,
  selectos_sku  TEXT        NOT NULL UNIQUE,
  producto_id   INT         NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  confianza     FLOAT,
  metodo        TEXT        NOT NULL DEFAULT 'nlp',
  validado      BOOLEAN     NOT NULL DEFAULT FALSE,
  rechazado     BOOLEAN     NOT NULL DEFAULT FALSE,
  validado_at   TIMESTAMPTZ,
  notas         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mapeo_selectos_sku
  ON mapeo_selectos(selectos_sku);

CREATE INDEX IF NOT EXISTS idx_mapeo_selectos_pendientes
  ON mapeo_selectos(validado, rechazado)
  WHERE NOT validado AND NOT rechazado;

CREATE INDEX IF NOT EXISTS idx_mapeo_selectos_producto
  ON mapeo_selectos(producto_id);
"""

# Intentar via RPC query (si existe la función)
r = httpx.post(f'{URL}/rest/v1/rpc/query',
    headers=H, json={'sql': SQL}, timeout=30)

if r.status_code == 200:
    print('✅ Tabla creada via RPC query')
else:
    print(f'RPC query no disponible ({r.status_code}). Intentando via management API...')

    # Extraer project_id de la URL
    project_id = URL.replace('https://', '').split('.')[0]

    # Intentar via Supabase Management API
    r2 = httpx.post(
        f'https://api.supabase.com/v1/projects/{project_id}/database/query',
        headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'},
        json={'query': SQL},
        timeout=30
    )
    if r2.status_code in (200, 201):
        print('✅ Tabla creada via Management API')
    else:
        print(f'Management API: {r2.status_code} — {r2.text[:200]}')
        print()
        print('⚠️  Por favor ejecuta este SQL manualmente en el Supabase Dashboard:')
        print('   https://supabase.com/dashboard/project/uyilxvplfuverjgjvjmf/sql/new')
        print()
        print(SQL)
        sys.exit(1)

# Insertar el mapeo del Dove validado manualmente
INSERT = """
INSERT INTO mapeo_selectos (selectos_sku, producto_id, confianza, metodo, validado, validado_at, notas)
VALUES ('112758', 87, 1.0, 'manual', TRUE, NOW(),
        'Jabón Dove Original 90g 3 Pack = Jabón Dove Original Hidratación Profunda 3 Pack 270g')
ON CONFLICT (selectos_sku) DO NOTHING;
"""
r3 = httpx.post(f'{URL}/rest/v1/rpc/query',
    headers=H, json={'sql': INSERT}, timeout=30)
if r3.status_code == 200:
    print('✅ Mapeo del Dove insertado')
else:
    # Intentar insert via REST
    r4 = httpx.post(f'{URL}/rest/v1/mapeo_selectos', headers={**H, 'Prefer': 'resolution=ignore-duplicates'},
        json={'selectos_sku': '112758', 'producto_id': 87, 'confianza': 1.0,
              'metodo': 'manual', 'validado': True,
              'notas': 'Jabón Dove Original 90g 3 Pack = Jabón Dove Original Hidratación Profunda 3 Pack 270g'})
    if r4.status_code in (200, 201):
        print('✅ Mapeo del Dove insertado')
    else:
        print(f'Mapeo Dove: {r4.status_code} — {r4.text[:100]}')

print('Listo.')

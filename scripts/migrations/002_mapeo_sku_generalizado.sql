-- ============================================================
-- MIGRACIÓN: Generalizar mapeo_selectos → mapeo_sku
-- Aplica para cualquier supermercado sin EAN
-- Ejecutar en: https://supabase.com/dashboard/project/uyilxvplfuverjgjvjmf/sql/new
-- ============================================================

-- 1. Tabla generalizada
CREATE TABLE IF NOT EXISTS mapeo_sku (
  id              BIGSERIAL   PRIMARY KEY,
  supermercado_id INT         NOT NULL REFERENCES supermercados(id),
  sku_local       TEXT        NOT NULL,
  producto_id     INT         NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  confianza       FLOAT,
  metodo          TEXT        NOT NULL DEFAULT 'nlp',  -- 'nlp','ean','manual','imagen'
  validado        BOOLEAN     NOT NULL DEFAULT FALSE,
  rechazado       BOOLEAN     NOT NULL DEFAULT FALSE,
  validado_at     TIMESTAMPTZ,
  notas           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (supermercado_id, sku_local)
);

CREATE INDEX IF NOT EXISTS idx_mapeo_sku_lookup
  ON mapeo_sku(supermercado_id, sku_local);

CREATE INDEX IF NOT EXISTS idx_mapeo_sku_pendientes
  ON mapeo_sku(validado, rechazado, supermercado_id)
  WHERE NOT validado AND NOT rechazado;

CREATE INDEX IF NOT EXISTS idx_mapeo_sku_producto
  ON mapeo_sku(producto_id);

COMMENT ON TABLE mapeo_sku IS
  'Mapeo persistente (supermercado_id + sku_local) → producto canónico. '
  'Aplica para cualquier tienda sin EAN. Validado por usuario una sola vez.';

-- 2. Migrar datos existentes de mapeo_selectos (si existe)
INSERT INTO mapeo_sku (supermercado_id, sku_local, producto_id, confianza, metodo, validado, rechazado, validado_at, notas, created_at)
SELECT
  1 AS supermercado_id,  -- Selectos = 1
  selectos_sku,
  producto_id,
  confianza,
  metodo,
  validado,
  rechazado,
  validado_at,
  notas,
  created_at
FROM mapeo_selectos
ON CONFLICT (supermercado_id, sku_local) DO NOTHING;

-- 3. Eliminar tabla vieja (ya migrada)
DROP TABLE IF EXISTS mapeo_selectos;

-- 4. Verificación
SELECT
  s.nombre AS supermercado,
  m.sku_local,
  p.nombre AS producto,
  p.ean,
  m.metodo,
  m.validado,
  m.confianza,
  m.notas
FROM mapeo_sku m
JOIN supermercados s ON s.id = m.supermercado_id
JOIN productos     p ON p.id = m.producto_id
ORDER BY m.created_at DESC;

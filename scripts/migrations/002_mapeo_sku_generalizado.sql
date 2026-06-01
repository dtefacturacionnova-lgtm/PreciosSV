-- ============================================================
-- MIGRACIÓN: Crear tabla mapeo_sku (generalizada para cualquier tienda)
-- Ejecutar en: https://supabase.com/dashboard/project/uyilxvplfuverjgjvjmf/sql/new
-- ============================================================

-- 1. Crear tabla generalizada
CREATE TABLE IF NOT EXISTS mapeo_sku (
  id              BIGSERIAL   PRIMARY KEY,
  supermercado_id INT         NOT NULL REFERENCES supermercados(id),
  sku_local       TEXT        NOT NULL,
  producto_id     INT         NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  confianza       FLOAT,
  metodo          TEXT        NOT NULL DEFAULT 'nlp',
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
  'Para cualquier tienda sin EAN. Validado por usuario una sola vez.';

-- 2. Migrar datos de mapeo_selectos SI existe (manejo seguro)
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'mapeo_selectos'
  ) THEN
    INSERT INTO mapeo_sku
      (supermercado_id, sku_local, producto_id, confianza,
       metodo, validado, rechazado, validado_at, notas, created_at)
    SELECT
      1,               -- Selectos = supermercado_id 1
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

    DROP TABLE mapeo_selectos;
    RAISE NOTICE 'mapeo_selectos migrado y eliminado correctamente';
  ELSE
    RAISE NOTICE 'mapeo_selectos no existe — se crea mapeo_sku limpio';
  END IF;
END $$;

-- 3. Insertar el Dove validado manualmente (idempotente)
INSERT INTO mapeo_sku
  (supermercado_id, sku_local, producto_id, confianza,
   metodo, validado, validado_at, notas)
VALUES
  (1, '112758', 87, 1.0, 'manual', TRUE, NOW(),
   'Jabón Dove Original 90g 3 Pack = Jabón Dove Original Hidratación Profunda 3 Pack 270g (EAN 7891150046481)')
ON CONFLICT (supermercado_id, sku_local) DO NOTHING;

-- 4. Verificar resultado
SELECT
  s.nombre        AS supermercado,
  m.sku_local,
  p.nombre        AS producto,
  p.ean,
  m.metodo,
  m.validado,
  m.confianza,
  m.notas
FROM mapeo_sku m
JOIN supermercados s ON s.id = m.supermercado_id
JOIN productos     p ON p.id = m.producto_id
ORDER BY m.created_at DESC;

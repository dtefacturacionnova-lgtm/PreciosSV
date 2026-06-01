-- ============================================================
-- MIGRACIÓN: Tabla mapeo_selectos
-- Ejecutar en: https://supabase.com/dashboard/project/uyilxvplfuverjgjvjmf/sql/new
-- ============================================================

-- Tabla principal de mapeo
CREATE TABLE IF NOT EXISTS mapeo_selectos (
  id            BIGSERIAL   PRIMARY KEY,
  selectos_sku  TEXT        NOT NULL UNIQUE,   -- productId del sitio Selectos (sku_local)
  producto_id   INT         NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  confianza     FLOAT,                          -- score NLP 0.0-1.0
  metodo        TEXT        NOT NULL DEFAULT 'nlp',  -- 'nlp','ean','manual','imagen'
  validado      BOOLEAN     NOT NULL DEFAULT FALSE,
  rechazado     BOOLEAN     NOT NULL DEFAULT FALSE,
  validado_at   TIMESTAMPTZ,
  notas         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para búsqueda rápida en el scraper
CREATE INDEX IF NOT EXISTS idx_mapeo_selectos_sku
  ON mapeo_selectos(selectos_sku);

CREATE INDEX IF NOT EXISTS idx_mapeo_selectos_pendientes
  ON mapeo_selectos(validado, rechazado)
  WHERE NOT validado AND NOT rechazado;

CREATE INDEX IF NOT EXISTS idx_mapeo_selectos_producto
  ON mapeo_selectos(producto_id);

-- Comentario
COMMENT ON TABLE mapeo_selectos IS
  'Mapeo persistente SKU Selectos → producto canónico. Evita re-normalizar en cada scraping. Validado por usuario una sola vez.';

-- ============================================================
-- DATOS INICIALES: Mapeos validados manualmente
-- ============================================================

-- Jabón Dove Original 90g 3 Pack (productId=112758 en Selectos)
-- = Jabón Dove Original, Hidratación Profunda 3 Pack 270g (producto_id=87)
INSERT INTO mapeo_selectos (selectos_sku, producto_id, confianza, metodo, validado, validado_at, notas)
VALUES (
  '112758',
  87,
  1.0,
  'manual',
  TRUE,
  NOW(),
  'JABON DOVE ORIGINAL BLANCO 90G 3 UNIDADES = Jabón Dove Original Hidratación Profunda 3 Pack - 270g (EAN 7891150046481)'
)
ON CONFLICT (selectos_sku) DO NOTHING;

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
SELECT
  m.id,
  m.selectos_sku,
  p.nombre AS producto_nombre,
  p.ean,
  m.metodo,
  m.validado,
  m.confianza,
  m.notas
FROM mapeo_selectos m
JOIN productos p ON p.id = m.producto_id
ORDER BY m.created_at DESC;

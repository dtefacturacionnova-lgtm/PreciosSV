-- ============================================================
-- PreciosSV — Catálogo del Proveedor
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Catálogo de productos propios del proveedor
CREATE TABLE IF NOT EXISTS proveedor_catalogo (
  id              BIGSERIAL PRIMARY KEY,
  proveedor_id    BIGINT NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  marca           TEXT NOT NULL,
  categoria_id    BIGINT REFERENCES categorias(id),
  presentacion    TEXT,          -- Barra, Botella, Caja, Bolsa, Spray, Sachet, etc.
  gramaje         NUMERIC,       -- cantidad numérica (ej: 90, 1000, 500)
  unidad          TEXT,          -- g, ml, un, kg, L
  ean_13          TEXT,          -- código de barras EAN-13 (13 dígitos)
  upc_12          TEXT,          -- código de barras UPC-12 (12 dígitos)
  codigo_interno  TEXT,          -- código del proveedor (SKU interno)
  imagen_url      TEXT,
  pvp_sugerido    NUMERIC,       -- precio de venta al público sugerido
  notas           TEXT,
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices proveedor_catalogo
CREATE INDEX IF NOT EXISTS idx_proveedor_catalogo_proveedor
  ON proveedor_catalogo(proveedor_id);

CREATE INDEX IF NOT EXISTS idx_proveedor_catalogo_ean
  ON proveedor_catalogo(ean_13)
  WHERE ean_13 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proveedor_catalogo_upc
  ON proveedor_catalogo(upc_12)
  WHERE upc_12 IS NOT NULL;

-- 2. Competidores equivalentes por producto
CREATE TABLE IF NOT EXISTS proveedor_competidores_catalogo (
  id                    BIGSERIAL PRIMARY KEY,
  producto_id           BIGINT NOT NULL REFERENCES proveedor_catalogo(id) ON DELETE CASCADE,
  competidor_ean_13     TEXT,
  competidor_upc_12     TEXT,
  competidor_nombre     TEXT NOT NULL,
  competidor_marca      TEXT NOT NULL,
  -- Tipo de relación competitiva
  tipo_relacion         TEXT NOT NULL DEFAULT 'SUSTITUTO_DIRECTO'
                        CHECK (tipo_relacion IN (
                          'SUSTITUTO_DIRECTO',
                          'ALTERNATIVA_PREMIUM',
                          'ALTERNATIVA_ECONOMICA'
                        )),
  -- Factor para comparar precio/unidad entre presentaciones distintas
  -- Ej: mi producto 90g vs competidor 100g → factor_conversion = 0.90
  factor_conversion     NUMERIC NOT NULL DEFAULT 1.0,
  misma_presentacion    BOOLEAN NOT NULL DEFAULT true,
  prioridad             INTEGER NOT NULL DEFAULT 2
                        CHECK (prioridad IN (1, 2, 3)), -- 1=alta 2=media 3=baja
  notas                 TEXT,
  activo                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices proveedor_competidores_catalogo
CREATE INDEX IF NOT EXISTS idx_competidores_producto
  ON proveedor_competidores_catalogo(producto_id);

CREATE INDEX IF NOT EXISTS idx_competidores_ean
  ON proveedor_competidores_catalogo(competidor_ean_13)
  WHERE competidor_ean_13 IS NOT NULL;

-- 3. Trigger: actualiza updated_at en proveedor_catalogo
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proveedor_catalogo_updated_at ON proveedor_catalogo;
CREATE TRIGGER trg_proveedor_catalogo_updated_at
  BEFORE UPDATE ON proveedor_catalogo
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Verificar creación
-- ============================================================
SELECT 'proveedor_catalogo creada OK' AS status
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_name = 'proveedor_catalogo'
);

SELECT 'proveedor_competidores_catalogo creada OK' AS status
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_name = 'proveedor_competidores_catalogo'
);

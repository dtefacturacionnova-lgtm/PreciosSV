-- ═══════════════════════════════════════════════════════════════════════
-- PreciosSV — Taxonomía del Catálogo del Proveedor
-- Agrega campos libres de Categoría y SubCategoría para filtrar y agrupar.
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE proveedor_catalogo
  ADD COLUMN IF NOT EXISTS categoria    TEXT,
  ADD COLUMN IF NOT EXISTS subcategoria TEXT;

COMMENT ON COLUMN proveedor_catalogo.categoria    IS 'Categoría libre definida por el proveedor, ej: Cuidado Personal';
COMMENT ON COLUMN proveedor_catalogo.subcategoria IS 'SubCategoría libre definida por el proveedor, ej: Jabones';

CREATE INDEX IF NOT EXISTS idx_proveedor_catalogo_categoria
  ON proveedor_catalogo(proveedor_id, categoria)
  WHERE categoria IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proveedor_catalogo_subcategoria
  ON proveedor_catalogo(proveedor_id, subcategoria)
  WHERE subcategoria IS NOT NULL;

-- Verificación
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'proveedor_catalogo'
  AND column_name IN ('categoria', 'subcategoria')
ORDER BY column_name;

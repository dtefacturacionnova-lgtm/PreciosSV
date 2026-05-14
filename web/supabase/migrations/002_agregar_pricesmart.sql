-- ============================================================
-- Migración 002: Agregar PriceSmart El Salvador
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

INSERT INTO public.supermercados (nombre, nombre_corto, color_hex, sitio_web)
VALUES (
  'PriceSmart El Salvador',
  'pricesmart',
  '#0051A5',
  'https://www.pricesmart.com/es-sv'
)
ON CONFLICT (nombre_corto) DO NOTHING;

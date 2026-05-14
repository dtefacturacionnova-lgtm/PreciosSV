-- ═══════════════════════════════════════════════════════════
-- PrecioSV — Inicialización de base de datos
-- Se ejecuta automáticamente al crear el contenedor PostgreSQL
-- ═══════════════════════════════════════════════════════════

-- Extensión para búsqueda por similitud de texto
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Supermercados ────────────────────────────────────────────
INSERT INTO supermercados (nombre, nombre_corto, url_base, plataforma, activo) VALUES
  ('Súper Selectos',            'selectos',     'https://www.superselectos.com',              'custom', true),
  ('Walmart El Salvador',       'walmart',      'https://www.walmart.com.sv',                 'vtex',   true),
  ('La Despensa de Don Juan',   'donjuan',      'https://www.ladespensadedonjuan.com.sv',     'vtex',   true),
  ('Maxi Despensa',             'maxidespensa', 'https://www.maxidespensa.com.sv',            'vtex',   true),
  ('Despensa Familiar',         'familiar',     'https://www.despensafamiliar.com.sv',        'vtex',   true)
ON CONFLICT DO NOTHING;

-- ── Categorías ───────────────────────────────────────────────
INSERT INTO categorias (nombre, slug, icono) VALUES
  ('Lácteos y Huevos',    'lacteos',      '🥛'),
  ('Abarrotes',           'abarrotes',    '🥫'),
  ('Bebidas',             'bebidas',      '🥤'),
  ('Carnes y Mariscos',   'carnes',       '🥩'),
  ('Frutas y Verduras',   'frescos',      '🥬'),
  ('Limpieza del Hogar',  'limpieza',     '🧴'),
  ('Cuidado Personal',    'personal',     '🧼'),
  ('Panadería',           'panaderia',    '🍞'),
  ('Congelados',          'congelados',   '🧊'),
  ('Bebés y Niños',       'bebes',        '🍼')
ON CONFLICT (slug) DO NOTHING;

-- ── Usuario administrador por defecto ────────────────────────
-- Contraseña: Admin123! (cambiar en producción)
INSERT INTO usuarios (email, nombre, hashed_password, role, activo) VALUES
  (
    'admin@preciosv.com',
    'Administrador PrecioSV',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/RK.s5uJEi',
    'admin',
    true
  )
ON CONFLICT (email) DO NOTHING;

-- ── Vista materializada: precios actuales ────────────────────
-- Se refresca después de cada ciclo de scraping
CREATE MATERIALIZED VIEW IF NOT EXISTS precios_actuales AS
SELECT DISTINCT ON (pv.producto_id, pv.supermercado_id)
    pv.producto_id,
    pv.supermercado_id,
    p.precio_normal,
    p.precio_oferta,
    p.en_oferta,
    p.descuento_pct,
    p.fecha_hora,
    p.disponible
FROM precios p
JOIN producto_variantes pv ON p.variante_id = pv.id
ORDER BY pv.producto_id, pv.supermercado_id, p.fecha_hora DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_precios_actuales_pk
    ON precios_actuales (producto_id, supermercado_id);

-- Función para refrescar la vista (llamada por el scraper al terminar)
CREATE OR REPLACE FUNCTION refresh_precios_actuales()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY precios_actuales;
END;
$$ LANGUAGE plpgsql;

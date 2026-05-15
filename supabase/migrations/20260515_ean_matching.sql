-- ═══════════════════════════════════════════════════════════════════════════════
-- F2.5 + F2.6 — Auto-enlace EAN entre catálogo del proveedor y productos scraped
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query
--
-- Columnas agregadas:
--   proveedor_catalogo.producto_id            → productos.id  (mi producto scrapeado)
--   proveedor_competidores_catalogo.competidor_producto_id
--                                             → productos.id  (producto del competidor)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Agregar producto_id a proveedor_catalogo ──────────────────────────────
--    Sin conflicto: proveedor_catalogo no tiene ningún producto_id todavía.
ALTER TABLE proveedor_catalogo
  ADD COLUMN IF NOT EXISTS producto_id INTEGER
    REFERENCES productos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_proveedor_catalogo_producto_id
  ON proveedor_catalogo(producto_id)
  WHERE producto_id IS NOT NULL;

-- ── 2. Agregar competidor_producto_id a proveedor_competidores_catalogo ──────
--    Nombre distinto porque producto_id ya apunta a proveedor_catalogo(id).
ALTER TABLE proveedor_competidores_catalogo
  ADD COLUMN IF NOT EXISTS competidor_producto_id INTEGER
    REFERENCES productos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_proveedor_comp_catalogo_cpid
  ON proveedor_competidores_catalogo(competidor_producto_id)
  WHERE competidor_producto_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TRIGGERS: matching automático al insertar/actualizar EAN
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 3. proveedor_catalogo: auto-poblar producto_id cuando se ingresa EAN ─────
CREATE OR REPLACE FUNCTION match_proveedor_catalogo_ean()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Intentar por ean_13 primero
  IF NEW.ean_13 IS NOT NULL THEN
    SELECT id INTO NEW.producto_id
      FROM productos WHERE ean = NEW.ean_13 LIMIT 1;
  END IF;

  -- Fallback: intentar por upc_12
  IF NEW.producto_id IS NULL AND NEW.upc_12 IS NOT NULL THEN
    SELECT id INTO NEW.producto_id
      FROM productos WHERE ean = NEW.upc_12 LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_match_proveedor_catalogo_ean ON proveedor_catalogo;
CREATE TRIGGER trg_match_proveedor_catalogo_ean
  BEFORE INSERT OR UPDATE OF ean_13, upc_12
  ON proveedor_catalogo
  FOR EACH ROW
  EXECUTE FUNCTION match_proveedor_catalogo_ean();

-- ── 4. proveedor_competidores_catalogo: auto-poblar competidor_producto_id ───
CREATE OR REPLACE FUNCTION match_competidor_catalogo_ean()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.competidor_ean_13 IS NOT NULL THEN
    SELECT id INTO NEW.competidor_producto_id
      FROM productos WHERE ean = NEW.competidor_ean_13 LIMIT 1;
  END IF;

  IF NEW.competidor_producto_id IS NULL AND NEW.competidor_upc_12 IS NOT NULL THEN
    SELECT id INTO NEW.competidor_producto_id
      FROM productos WHERE ean = NEW.competidor_upc_12 LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_match_competidor_catalogo_ean ON proveedor_competidores_catalogo;
CREATE TRIGGER trg_match_competidor_catalogo_ean
  BEFORE INSERT OR UPDATE OF competidor_ean_13, competidor_upc_12
  ON proveedor_competidores_catalogo
  FOR EACH ROW
  EXECUTE FUNCTION match_competidor_catalogo_ean();

-- ── 5. Trigger inverso: cuando el scraper guarda un producto con EAN,
--        enlazar automáticamente con el catálogo del proveedor ────────────────
CREATE OR REPLACE FUNCTION sync_productos_ean_to_catalogo()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ean IS NOT NULL THEN
    -- Mis productos propios
    UPDATE proveedor_catalogo
       SET producto_id = NEW.id
     WHERE (ean_13 = NEW.ean OR upc_12 = NEW.ean)
       AND producto_id IS NULL;

    -- Productos competidores mapeados
    UPDATE proveedor_competidores_catalogo
       SET competidor_producto_id = NEW.id
     WHERE (competidor_ean_13 = NEW.ean OR competidor_upc_12 = NEW.ean)
       AND competidor_producto_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_productos_ean ON productos;
CREATE TRIGGER trg_sync_productos_ean
  AFTER INSERT OR UPDATE OF ean
  ON productos
  FOR EACH ROW
  EXECUTE FUNCTION sync_productos_ean_to_catalogo();

-- ═══════════════════════════════════════════════════════════════════════════════
-- BACKFILL: matchear EANs ya existentes en ambas tablas
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE proveedor_catalogo pc
   SET producto_id = p.id
  FROM productos p
 WHERE (pc.ean_13 = p.ean OR pc.upc_12 = p.ean)
   AND pc.producto_id IS NULL;

UPDATE proveedor_competidores_catalogo cc
   SET competidor_producto_id = p.id
  FROM productos p
 WHERE (cc.competidor_ean_13 = p.ean OR cc.competidor_upc_12 = p.ean)
   AND cc.competidor_producto_id IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FUNCIÓN: precios actuales de un producto en cada supermercado
-- Uso: SELECT * FROM fn_precios_por_producto(42);
-- ═══════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS fn_precios_por_producto(INTEGER);
CREATE OR REPLACE FUNCTION fn_precios_por_producto(p_producto_id INTEGER)
RETURNS TABLE (
  supermercado_key    TEXT,
  supermercado_nombre TEXT,
  logo_url            TEXT,
  nombre_local        TEXT,
  url_producto        TEXT,
  precio_normal       NUMERIC,
  precio_oferta       NUMERIC,
  en_oferta           BOOLEAN,
  descuento_pct       NUMERIC,
  condicion_oferta    TEXT,
  disponible          BOOLEAN,
  fecha_hora          TIMESTAMPTZ
) LANGUAGE SQL STABLE AS $$
  SELECT
    s.nombre_corto::TEXT,
    s.nombre::TEXT,
    s.logo_url::TEXT,
    pv.nombre_local::TEXT,
    pv.url_producto::TEXT,
    pr.precio_normal,
    pr.precio_oferta,
    pr.en_oferta,
    pr.descuento_pct,
    pr.condicion_oferta::TEXT,
    pr.disponible,
    pr.fecha_hora
  FROM producto_variantes pv
  JOIN supermercados s ON s.id = pv.supermercado_id AND s.activo
  JOIN LATERAL (
    SELECT precio_normal, precio_oferta, en_oferta,
           descuento_pct, condicion_oferta, disponible, fecha_hora
      FROM precios
     WHERE variante_id = pv.id
     ORDER BY fecha_hora DESC
     LIMIT 1
  ) pr ON true
  WHERE pv.producto_id = p_producto_id
    AND pv.activo
  ORDER BY pr.precio_normal ASC;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FUNCIÓN: comparativa de precios — mi producto vs competidores (por supermercado)
-- Uso: SELECT * FROM fn_comparativa_precios(catalogo_id);
-- ═══════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS fn_comparativa_precios(INTEGER);
CREATE OR REPLACE FUNCTION fn_comparativa_precios(p_catalogo_id INTEGER)
RETURNS TABLE (
  es_propio           BOOLEAN,
  etiqueta            TEXT,
  marca               TEXT,
  tipo_relacion       TEXT,
  factor_conversion   NUMERIC,
  supermercado_key    TEXT,
  supermercado_nombre TEXT,
  precio_normal       NUMERIC,
  precio_oferta       NUMERIC,
  en_oferta           BOOLEAN,
  precio_normalizado  NUMERIC,
  fecha_hora          TIMESTAMPTZ
) LANGUAGE SQL STABLE AS $$
  -- ── Mi producto en cada supermercado ────────────────────────────────────
  SELECT
    true,
    pc.nombre::TEXT,
    pc.marca::TEXT,
    NULL::TEXT,
    1.0::NUMERIC,
    s.nombre_corto::TEXT,
    s.nombre::TEXT,
    pr.precio_normal,
    pr.precio_oferta,
    pr.en_oferta,
    pr.precio_normal,
    pr.fecha_hora
  FROM proveedor_catalogo pc
  JOIN producto_variantes pv ON pv.producto_id = pc.producto_id AND pv.activo
  JOIN supermercados s       ON s.id = pv.supermercado_id AND s.activo
  JOIN LATERAL (
    SELECT precio_normal, precio_oferta, en_oferta, fecha_hora
      FROM precios WHERE variante_id = pv.id ORDER BY fecha_hora DESC LIMIT 1
  ) pr ON true
  WHERE pc.id = p_catalogo_id
    AND pc.producto_id IS NOT NULL

  UNION ALL

  -- ── Cada competidor con EAN enlazado en cada supermercado ───────────────
  SELECT
    false,
    cc.competidor_nombre::TEXT,
    cc.competidor_marca::TEXT,
    cc.tipo_relacion::TEXT,
    cc.factor_conversion,
    s.nombre_corto::TEXT,
    s.nombre::TEXT,
    pr.precio_normal,
    pr.precio_oferta,
    pr.en_oferta,
    (pr.precio_normal * cc.factor_conversion)::NUMERIC,
    pr.fecha_hora
  FROM proveedor_competidores_catalogo cc
  JOIN producto_variantes pv ON pv.producto_id = cc.competidor_producto_id AND pv.activo
  JOIN supermercados s       ON s.id = pv.supermercado_id AND s.activo
  JOIN LATERAL (
    SELECT precio_normal, precio_oferta, en_oferta, fecha_hora
      FROM precios WHERE variante_id = pv.id ORDER BY fecha_hora DESC LIMIT 1
  ) pr ON true
  WHERE cc.producto_id = p_catalogo_id   -- FK a proveedor_catalogo(id)
    AND cc.competidor_producto_id IS NOT NULL
    AND cc.activo

  ORDER BY 1 DESC, 6, 8;  -- propio primero → por supermercado → por precio
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT
  'proveedor_catalogo' AS tabla,
  COUNT(*)             AS total_con_ean,
  COUNT(producto_id)   AS con_match,
  CONCAT(ROUND(COUNT(producto_id)::NUMERIC / NULLIF(COUNT(*),0)*100, 1), '%') AS pct_match
FROM proveedor_catalogo
WHERE ean_13 IS NOT NULL OR upc_12 IS NOT NULL

UNION ALL

SELECT
  'proveedor_competidores_catalogo',
  COUNT(*),
  COUNT(competidor_producto_id),
  CONCAT(ROUND(COUNT(competidor_producto_id)::NUMERIC / NULLIF(COUNT(*),0)*100, 1), '%')
FROM proveedor_competidores_catalogo
WHERE competidor_ean_13 IS NOT NULL OR competidor_upc_12 IS NOT NULL;

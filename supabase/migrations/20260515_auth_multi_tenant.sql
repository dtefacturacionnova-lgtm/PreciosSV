-- ═══════════════════════════════════════════════════════════════════════════════
-- FA — Auth Multi-Tenant
-- Vincula cada proveedor a un usuario de Supabase Auth.
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Columna user_id en proveedores ───────────────────────────────────────
ALTER TABLE proveedores
  ADD COLUMN IF NOT EXISTS user_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- Índice único: 1 proveedor por usuario
CREATE UNIQUE INDEX IF NOT EXISTS idx_proveedores_user_id
  ON proveedores(user_id)
  WHERE user_id IS NOT NULL;

-- ── 2. RLS en proveedores ────────────────────────────────────────────────────
ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;

-- Service role siempre puede ver todo (scrapers, crons)
-- Usuario autenticado solo ve su propio proveedor
DROP POLICY IF EXISTS "proveedor_ver_propio"    ON proveedores;
DROP POLICY IF EXISTS "proveedor_editar_propio"  ON proveedores;

CREATE POLICY "proveedor_ver_propio"
  ON proveedores FOR SELECT
  USING (user_id = auth.uid() OR auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "proveedor_editar_propio"
  ON proveedores FOR UPDATE
  USING (user_id = auth.uid());

-- ── 3. RLS en proveedor_catalogo ─────────────────────────────────────────────
ALTER TABLE proveedor_catalogo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catalogo_ver_propio"    ON proveedor_catalogo;
DROP POLICY IF EXISTS "catalogo_editar_propio"  ON proveedor_catalogo;
DROP POLICY IF EXISTS "catalogo_crear_propio"   ON proveedor_catalogo;
DROP POLICY IF EXISTS "catalogo_borrar_propio"  ON proveedor_catalogo;

CREATE POLICY "catalogo_ver_propio"
  ON proveedor_catalogo FOR SELECT
  USING (
    proveedor_id IN (SELECT id FROM proveedores WHERE user_id = auth.uid())
    OR auth.jwt() ->> 'role' = 'service_role'
  );

CREATE POLICY "catalogo_editar_propio"
  ON proveedor_catalogo FOR UPDATE
  USING (proveedor_id IN (SELECT id FROM proveedores WHERE user_id = auth.uid()));

CREATE POLICY "catalogo_crear_propio"
  ON proveedor_catalogo FOR INSERT
  WITH CHECK (proveedor_id IN (SELECT id FROM proveedores WHERE user_id = auth.uid()));

CREATE POLICY "catalogo_borrar_propio"
  ON proveedor_catalogo FOR DELETE
  USING (proveedor_id IN (SELECT id FROM proveedores WHERE user_id = auth.uid()));

-- ── 4. RLS en proveedor_competidores_catalogo ────────────────────────────────
ALTER TABLE proveedor_competidores_catalogo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "competidores_ver_propio"   ON proveedor_competidores_catalogo;
DROP POLICY IF EXISTS "competidores_editar_propio" ON proveedor_competidores_catalogo;
DROP POLICY IF EXISTS "competidores_crear_propio"  ON proveedor_competidores_catalogo;
DROP POLICY IF EXISTS "competidores_borrar_propio" ON proveedor_competidores_catalogo;

CREATE POLICY "competidores_ver_propio"
  ON proveedor_competidores_catalogo FOR SELECT
  USING (
    producto_id IN (
      SELECT pc.id FROM proveedor_catalogo pc
      JOIN proveedores p ON p.id = pc.proveedor_id
      WHERE p.user_id = auth.uid()
    )
    OR auth.jwt() ->> 'role' = 'service_role'
  );

CREATE POLICY "competidores_editar_propio"
  ON proveedor_competidores_catalogo FOR UPDATE
  USING (
    producto_id IN (
      SELECT pc.id FROM proveedor_catalogo pc
      JOIN proveedores p ON p.id = pc.proveedor_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "competidores_crear_propio"
  ON proveedor_competidores_catalogo FOR INSERT
  WITH CHECK (
    producto_id IN (
      SELECT pc.id FROM proveedor_catalogo pc
      JOIN proveedores p ON p.id = pc.proveedor_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "competidores_borrar_propio"
  ON proveedor_competidores_catalogo FOR DELETE
  USING (
    producto_id IN (
      SELECT pc.id FROM proveedor_catalogo pc
      JOIN proveedores p ON p.id = pc.proveedor_id
      WHERE p.user_id = auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- FUNCIÓN HELPER: obtener proveedor_id del usuario autenticado
-- Uso desde SQL: SELECT id FROM fn_proveedor_del_usuario();
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_proveedor_del_usuario()
RETURNS INTEGER LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT id FROM proveedores WHERE user_id = auth.uid() LIMIT 1;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- INSTRUCCIONES POST-MIGRACIÓN
-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Crear el usuario en Supabase Auth Dashboard (o via API):
--    Email: contacto@tuproveedora.com
-- 2. Obtener el UUID del usuario creado.
-- 3. Vincularlo al proveedor existente:
--    UPDATE proveedores SET user_id = '<UUID-del-usuario>' WHERE id = 1;
-- 4. Repetir para cada proveedor adicional.
-- ═══════════════════════════════════════════════════════════════════════════════

-- VERIFICACIÓN: muestra proveedores con y sin usuario vinculado
SELECT id, razon_social, user_id,
       CASE WHEN user_id IS NULL THEN '⚠ sin usuario' ELSE '✓ vinculado' END AS estado
FROM proveedores
ORDER BY id;

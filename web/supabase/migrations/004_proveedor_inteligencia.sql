-- ============================================================
-- PreciosSV — Migración 004
-- Inteligencia de mercado para proveedores
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

-- ── 1. Marcas competidoras por proveedor ─────────────────────
ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS competidores text[] NOT NULL DEFAULT '{}';

-- ── 2. Precios de referencia sugeridos por el proveedor ───────
--    El proveedor define su PVP sugerido por producto para
--    detectar desviaciones en supermercados.
CREATE TABLE IF NOT EXISTS public.proveedor_precios_referencia (
  id              serial PRIMARY KEY,
  proveedor_id    integer NOT NULL REFERENCES public.proveedores(id) ON DELETE CASCADE,
  producto_id     integer NOT NULL REFERENCES public.productos(id)  ON DELETE CASCADE,
  precio_sugerido numeric(10,2),          -- PVP sugerido (precio normal)
  precio_promo    numeric(10,2),          -- Precio durante promoción activa
  en_promocion    boolean NOT NULL DEFAULT false,
  notas           text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proveedor_id, producto_id)
);

-- RLS
ALTER TABLE public.proveedor_precios_referencia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "proveedor ve sus referencias"
  ON public.proveedor_precios_referencia FOR SELECT
  USING (
    proveedor_id IN (
      SELECT p.id FROM public.proveedores p
      JOIN public.usuarios u ON u.id = p.usuario_id
      WHERE u.auth_id = auth.uid()
    )
  );

CREATE POLICY "proveedor gestiona sus referencias"
  ON public.proveedor_precios_referencia FOR ALL
  USING (
    proveedor_id IN (
      SELECT p.id FROM public.proveedores p
      JOIN public.usuarios u ON u.id = p.usuario_id
      WHERE u.auth_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proveedor_precios_referencia TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.proveedor_precios_referencia_id_seq TO authenticated;

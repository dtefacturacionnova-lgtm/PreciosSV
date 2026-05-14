-- ============================================================
-- PreciosSV — Migración 003
-- RLS para proveedores + función de setup inicial
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

-- ── 1. RLS policy: cada proveedor ve solo su propio registro ──
create policy "proveedor ve su propio perfil"
  on public.proveedores for select
  using (
    usuario_id = (select id from public.usuarios where auth_id = auth.uid())
  );

create policy "proveedor actualiza su propio perfil"
  on public.proveedores for update
  using (
    usuario_id = (select id from public.usuarios where auth_id = auth.uid())
  );

-- Admins ven todos los proveedores
create policy "admin ve todos los proveedores"
  on public.proveedores for all
  using (
    exists (
      select 1 from public.usuarios
      where auth_id = auth.uid() and rol = 'admin'
    )
  );

-- ── 2. RLS policy: proveedores ven todos los productos activos ─
--    (ya existe lectura pública, pero dejamos explícito el access
--     para precios_actuales que es una vista materializada)

-- Las vistas materializadas no tienen RLS automático en Supabase.
-- Aseguramos acceso público al anon role:
grant select on public.precios_actuales to anon, authenticated;

-- ── 3. Función helper para promover usuario a proveedor ────────
--    Uso: SELECT setup_proveedor('uuid-del-auth-user', 'Mi Empresa S.A.', ARRAY['MiMarca', 'OtraMarca']);
create or replace function public.setup_proveedor(
  p_auth_id    uuid,
  p_razon_social text,
  p_marcas     text[]
)
returns text
language plpgsql
security definer
as $$
declare
  v_usuario_id integer;
begin
  -- Actualizar rol del usuario
  update public.usuarios
  set rol = 'proveedor'
  where auth_id = p_auth_id
  returning id into v_usuario_id;

  if v_usuario_id is null then
    return 'ERROR: usuario no encontrado. ¿Se registró primero?';
  end if;

  -- Insertar o actualizar registro de proveedor
  insert into public.proveedores (usuario_id, razon_social, marcas)
  values (v_usuario_id, p_razon_social, p_marcas)
  on conflict (usuario_id) do update
    set razon_social = excluded.razon_social,
        marcas       = excluded.marcas;

  return 'OK: proveedor configurado. usuario_id=' || v_usuario_id;
end;
$$;

-- Solo admin puede llamar esta función directamente
-- En producción se invocará desde un panel de admin
revoke execute on function public.setup_proveedor from anon;
grant execute on function public.setup_proveedor to service_role;

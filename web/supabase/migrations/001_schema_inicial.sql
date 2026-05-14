-- ============================================================
-- PreciosSV — Migración inicial para Supabase
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

-- Extensiones necesarias
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- ── Supermercados ────────────────────────────────────────────
create table public.supermercados (
  id          serial primary key,
  nombre      text not null,
  nombre_corto text not null unique,
  logo_url    text,
  color_hex   text not null default '#6B7280',
  sitio_web   text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.supermercados (nombre, nombre_corto, color_hex, sitio_web) values
  ('Súper Selectos',          'selectos',     '#DC2626', 'https://www.superselectos.com'),
  ('Walmart El Salvador',     'walmart',      '#1D4ED8', 'https://www.walmart.com.sv'),
  ('La Despensa de Don Juan', 'donjuan',      '#16A34A', 'https://www.ladespensadedonjuan.com.sv'),
  ('Maxi Despensa',           'maxidespensa', '#EA580C', 'https://www.maxidespensa.com.sv'),
  ('Despensa Familiar',       'familiar',     '#7C3AED', 'https://www.despensafamiliar.com.sv');

-- ── Categorías ───────────────────────────────────────────────
create table public.categorias (
  id        serial primary key,
  nombre    text not null,
  slug      text not null unique,
  icono     text,
  parent_id integer references public.categorias(id),
  activa    boolean not null default true
);

insert into public.categorias (nombre, slug, icono) values
  ('Lácteos y Huevos',   'lacteos-huevos',   '🥛'),
  ('Carnes y Embutidos', 'carnes',            '🥩'),
  ('Frutas y Verduras',  'frutas-verduras',   '🥦'),
  ('Abarrotes',          'abarrotes',         '🛒'),
  ('Bebidas',            'bebidas',           '🧃'),
  ('Limpieza',           'limpieza',          '🧹'),
  ('Cuidado Personal',   'cuidado-personal',  '🧴'),
  ('Panadería',          'panaderia',         '🍞'),
  ('Congelados',         'congelados',        '🧊'),
  ('Mascotas',           'mascotas',          '🐾');

-- ── Productos ────────────────────────────────────────────────
create table public.productos (
  id                  serial primary key,
  nombre_normalizado  text not null,
  marca               text,
  categoria_id        integer references public.categorias(id),
  descripcion         text,
  imagen_url          text,
  ean                 text unique,
  unidad              text,
  cantidad            numeric(10,3),
  activo              boolean not null default true,
  created_at          timestamptz not null default now()
);

-- Índices de búsqueda
create index ix_productos_ean on public.productos(ean) where ean is not null;
create index ix_productos_nombre_trgm on public.productos
  using gin (nombre_normalizado gin_trgm_ops);
create index ix_productos_marca_trgm on public.productos
  using gin (marca gin_trgm_ops);

-- ── Variantes por supermercado ───────────────────────────────
create table public.producto_variantes (
  id              serial primary key,
  producto_id     integer not null references public.productos(id) on delete cascade,
  supermercado_id integer not null references public.supermercados(id),
  nombre_local    text,
  sku_local       text not null,
  url_producto    text,
  activo          boolean not null default true,
  unique (supermercado_id, sku_local)
);

create index ix_variantes_producto on public.producto_variantes(producto_id);
create index ix_variantes_supermercado_sku on public.producto_variantes(supermercado_id, sku_local);

-- ── Historial de precios ─────────────────────────────────────
create table public.precios (
  id               serial primary key,
  variante_id      integer not null references public.producto_variantes(id) on delete cascade,
  precio_normal    numeric(10,2) not null,
  precio_oferta    numeric(10,2),
  en_oferta        boolean not null default false,
  descuento_pct    numeric(5,2),
  disponible       boolean not null default true,
  condicion_oferta text,
  fecha_hora       timestamptz not null default now()
);

create index ix_precios_variante_fecha on public.precios(variante_id, fecha_hora desc);
create index ix_precios_fecha on public.precios(fecha_hora desc);
create index ix_precios_oferta on public.precios(en_oferta, descuento_pct desc) where en_oferta = true;

-- ── Vista materializada: precio actual por variante ──────────
create materialized view public.precios_actuales as
  select distinct on (p.variante_id)
    p.variante_id,
    pv.producto_id,
    pv.supermercado_id,
    p.precio_normal,
    p.precio_oferta,
    p.en_oferta,
    p.descuento_pct,
    p.disponible,
    p.condicion_oferta,
    p.fecha_hora
  from public.precios p
  join public.producto_variantes pv on pv.id = p.variante_id
  order by p.variante_id, p.fecha_hora desc;

create unique index ix_precios_actuales_variante on public.precios_actuales(variante_id);
create index ix_precios_actuales_producto on public.precios_actuales(producto_id);
create index ix_precios_actuales_oferta on public.precios_actuales(en_oferta, descuento_pct desc) where en_oferta = true;

-- Función para refrescar la vista luego de cada scrape
create or replace function public.refrescar_precios_actuales()
returns void language sql security definer as $$
  refresh materialized view concurrently public.precios_actuales;
$$;

-- ── Usuarios (sincronizado con Supabase Auth) ────────────────
create table public.usuarios (
  id         serial primary key,
  auth_id    uuid not null unique references auth.users(id) on delete cascade,
  nombre     text not null,
  email      text not null unique,
  rol        text not null default 'usuario' check (rol in ('admin', 'proveedor', 'usuario')),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Trigger: crear perfil automáticamente cuando alguien se registra con Supabase Auth
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.usuarios (auth_id, nombre, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Alertas de precio (B2C) ──────────────────────────────────
create table public.alertas_usuario (
  id                  serial primary key,
  usuario_id          integer not null references public.usuarios(id) on delete cascade,
  producto_id         integer not null references public.productos(id) on delete cascade,
  precio_objetivo     numeric(10,2) not null,
  supermercado_id     integer references public.supermercados(id),
  activa              boolean not null default true,
  ultima_notificacion timestamptz,
  created_at          timestamptz not null default now(),
  unique (usuario_id, producto_id)
);

-- ── Proveedores B2B ──────────────────────────────────────────
create table public.proveedores (
  id          serial primary key,
  usuario_id  integer not null unique references public.usuarios(id),
  razon_social text not null,
  ruc         text,
  marcas      text[] not null default '{}',
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ── Auditoría de scrapers ────────────────────────────────────
create table public.ejecuciones_scraper (
  id                    serial primary key,
  supermercado_id       integer references public.supermercados(id),
  inicio                timestamptz not null default now(),
  fin                   timestamptz,
  estado                text not null default 'en_progreso'
                          check (estado in ('en_progreso','completado','completado_con_errores','fallido')),
  productos_encontrados integer not null default 0,
  productos_nuevos      integer not null default 0,
  productos_actualizados integer not null default 0,
  errores               integer not null default 0,
  duracion_segundos     integer
);

-- ── RLS (Row Level Security) ─────────────────────────────────
alter table public.supermercados      enable row level security;
alter table public.categorias         enable row level security;
alter table public.productos          enable row level security;
alter table public.producto_variantes enable row level security;
alter table public.precios            enable row level security;
alter table public.usuarios           enable row level security;
alter table public.alertas_usuario    enable row level security;
alter table public.proveedores        enable row level security;

-- Lectura pública para catálogo
create policy "lectura publica supermercados" on public.supermercados for select using (true);
create policy "lectura publica categorias"    on public.categorias     for select using (true);
create policy "lectura publica productos"     on public.productos      for select using (activo = true);
create policy "lectura publica variantes"     on public.producto_variantes for select using (activo = true);
create policy "lectura publica precios"       on public.precios        for select using (true);

-- Usuarios solo ven su propio perfil
create policy "usuario propio perfil" on public.usuarios
  for select using (auth_id = auth.uid());
create policy "usuario actualiza perfil" on public.usuarios
  for update using (auth_id = auth.uid());

-- Alertas solo las ve el dueño
create policy "alerta propia" on public.alertas_usuario
  for all using (
    usuario_id = (select id from public.usuarios where auth_id = auth.uid())
  );

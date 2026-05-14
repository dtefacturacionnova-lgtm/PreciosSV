/**
 * Seed script — inserta datos de prueba en Supabase
 * Ejecutar: node scripts/seed.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Leer .env.local manualmente
const envPath = resolve(__dirname, '../.env.local')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => l.split('=').map(s => s.trim()))
)

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY  // service role para bypass de RLS
)

// ── Helpers ──────────────────────────────────────────────────
function ok(label, data) {
  console.log(`  ✓ ${label}`)
  return data
}
function fail(label, error) {
  console.error(`  ✗ ${label}:`, error?.message ?? error)
  process.exit(1)
}

async function run() {
  console.log('\n🌱 Iniciando seed de PreciosSV...\n')

  // ── 1. Verificar supermercados ────────────────────────────
  console.log('1. Verificando supermercados...')
  const { data: supers, error: eSuper } = await supabase
    .from('supermercados').select('id, nombre_corto')
  if (eSuper) fail('supermercados', eSuper)
  ok(`${supers.length} supermercados encontrados`, supers)

  const superMap = Object.fromEntries(supers.map(s => [s.nombre_corto, s.id]))

  // ── 2. Verificar categorías ───────────────────────────────
  console.log('\n2. Verificando categorías...')
  const { data: cats, error: eCat } = await supabase
    .from('categorias').select('id, slug')
  if (eCat) fail('categorias', eCat)
  ok(`${cats.length} categorías encontradas`, cats)

  const catMap = Object.fromEntries(cats.map(c => [c.slug, c.id]))

  // ── 3. Insertar productos ─────────────────────────────────
  console.log('\n3. Insertando productos...')
  const productos = [
    { nombre_normalizado: 'Leche Entera LALA 1L',         marca: 'LALA',      categoria_id: catMap['lacteos-huevos'],  ean: '7501055300043', unidad: 'L',    cantidad: 1 },
    { nombre_normalizado: 'Aceite Vegetal La Yaya 1L',     marca: 'La Yaya',   categoria_id: catMap['abarrotes'],       ean: '7421002100012', unidad: 'L',    cantidad: 1 },
    { nombre_normalizado: 'Arroz Superior Calsa 5 lb',     marca: 'Calsa',     categoria_id: catMap['abarrotes'],       ean: '7421080100028', unidad: 'lb',   cantidad: 5 },
    { nombre_normalizado: 'Frijoles Rojos Conacaste 2 lb', marca: 'Conacaste', categoria_id: catMap['abarrotes'],       ean: '7421090200015', unidad: 'lb',   cantidad: 2 },
    { nombre_normalizado: 'Azúcar Blanca Central 1 kg',    marca: 'Central',   categoria_id: catMap['abarrotes'],       ean: '7421001300010', unidad: 'kg',   cantidad: 1 },
    { nombre_normalizado: 'Detergente Líquido Rinso 1L',   marca: 'Rinso',     categoria_id: catMap['limpieza'],        ean: '7501546910230', unidad: 'L',    cantidad: 1 },
    { nombre_normalizado: 'Jabón Dove Barra 90g',          marca: 'Dove',      categoria_id: catMap['cuidado-personal'],ean: '7501056325039', unidad: 'g',    cantidad: 90 },
    { nombre_normalizado: 'Pasta Dental Colgate 150ml',    marca: 'Colgate',   categoria_id: catMap['cuidado-personal'],ean: '7501054912007', unidad: 'ml',   cantidad: 150 },
    { nombre_normalizado: 'Shampoo Head & Shoulders 375ml',marca: "Head & Shoulders", categoria_id: catMap['cuidado-personal'], ean: '7501007022017', unidad: 'ml', cantidad: 375 },
    { nombre_normalizado: 'Pan Bimbo Grande',              marca: 'Bimbo',     categoria_id: catMap['panaderia'],       ean: '7441029503001', unidad: 'unidad', cantidad: 1 },
    { nombre_normalizado: 'Café Taza de Oro 400g',         marca: 'Taza de Oro',categoria_id: catMap['bebidas'],        ean: '7421005100038', unidad: 'g',    cantidad: 400 },
    { nombre_normalizado: 'Coca-Cola 2L',                  marca: 'Coca-Cola', categoria_id: catMap['bebidas'],         ean: '7501055327057', unidad: 'L',    cantidad: 2 },
  ]

  const { data: prodsIns, error: eProd } = await supabase
    .from('productos').insert(productos).select('id, nombre_normalizado')
  if (eProd) fail('productos', eProd)
  ok(`${prodsIns.length} productos insertados`)

  const prodMap = Object.fromEntries(prodsIns.map(p => [p.nombre_normalizado, p.id]))

  // ── 4. Insertar variantes y precios ───────────────────────
  console.log('\n4. Insertando variantes y precios por supermercado...')

  const ofertas = [
    // nombre_producto, supermercado_key, sku_local, precio_normal, precio_oferta, condicion
    ['Leche Entera LALA 1L',         'selectos',     'SEL-001', 2.75, 1.99, null],
    ['Leche Entera LALA 1L',         'walmart',      'WAL-001', 2.89, 2.45, null],
    ['Leche Entera LALA 1L',         'donjuan',      'DJ-001',  2.79, null, null],
    ['Aceite Vegetal La Yaya 1L',    'walmart',      'WAL-002', 4.50, 3.25, null],
    ['Aceite Vegetal La Yaya 1L',    'maxidespensa', 'MAX-001', 4.75, 3.50, null],
    ['Arroz Superior Calsa 5 lb',    'donjuan',      'DJ-002',  5.99, 4.49, null],
    ['Arroz Superior Calsa 5 lb',    'selectos',     'SEL-002', 6.25, null, null],
    ['Frijoles Rojos Conacaste 2 lb','maxidespensa', 'MAX-002', 3.25, 2.45, '2x1'],
    ['Frijoles Rojos Conacaste 2 lb','familiar',     'FAM-001', 3.10, null, null],
    ['Azúcar Blanca Central 1 kg',   'familiar',     'FAM-002', 1.99, 1.49, null],
    ['Azúcar Blanca Central 1 kg',   'selectos',     'SEL-003', 2.10, 1.59, null],
    ['Detergente Líquido Rinso 1L',  'selectos',     'SEL-004', 6.50, 4.75, null],
    ['Detergente Líquido Rinso 1L',  'walmart',      'WAL-003', 6.75, 5.10, null],
    ['Jabón Dove Barra 90g',         'walmart',      'WAL-004', 1.25, 0.89, null],
    ['Jabón Dove Barra 90g',         'donjuan',      'DJ-003',  1.30, 0.95, null],
    ['Pasta Dental Colgate 150ml',   'donjuan',      'DJ-004',  2.10, 1.59, null],
    ['Pasta Dental Colgate 150ml',   'maxidespensa', 'MAX-003', 2.25, null, null],
    ['Shampoo Head & Shoulders 375ml','walmart',     'WAL-005', 5.99, 4.25, null],
    ['Pan Bimbo Grande',             'selectos',     'SEL-005', 2.15, 1.65, null],
    ['Pan Bimbo Grande',             'familiar',     'FAM-003', 2.20, 1.70, null],
    ['Café Taza de Oro 400g',        'donjuan',      'DJ-005',  4.99, 3.75, null],
    ['Café Taza de Oro 400g',        'selectos',     'SEL-006', 5.10, null, null],
    ['Coca-Cola 2L',                 'walmart',      'WAL-006', 1.85, 1.45, null],
    ['Coca-Cola 2L',                 'maxidespensa', 'MAX-004', 1.90, 1.50, '3x$4'],
  ]

  for (const [nombre, supKey, sku, precioNormal, precioOferta, condicion] of ofertas) {
    const productoId = prodMap[nombre]
    const supermercadoId = superMap[supKey]
    if (!productoId || !supermercadoId) continue

    // Variante
    const { data: varData, error: eVar } = await supabase
      .from('producto_variantes')
      .insert({ producto_id: productoId, supermercado_id: supermercadoId, sku_local: sku, nombre_local: nombre })
      .select('id').single()
    if (eVar) { console.warn(`    ⚠ variante ${sku}: ${eVar.message}`); continue }

    // Precio
    const enOferta = precioOferta !== null
    const descuentoPct = enOferta
      ? Math.round((precioNormal - precioOferta) / precioNormal * 100 * 10) / 10
      : null

    const { error: ePrice } = await supabase
      .from('precios')
      .insert({
        variante_id: varData.id,
        precio_normal: precioNormal,
        precio_oferta: precioOferta,
        en_oferta: enOferta,
        descuento_pct: descuentoPct,
        condicion_oferta: condicion,
        disponible: true,
      })
    if (ePrice) console.warn(`    ⚠ precio ${sku}: ${ePrice.message}`)
  }
  ok(`${ofertas.length} variantes/precios procesados`)

  // ── 5. Refrescar vista materializada ─────────────────────
  console.log('\n5. Refrescando vista materializada precios_actuales...')
  const { error: eRefresh } = await supabase.rpc('refrescar_precios_actuales')
  if (eRefresh) fail('refresh view', eRefresh)
  ok('Vista materializada actualizada')

  // ── 6. Verificar resultado ────────────────────────────────
  console.log('\n6. Verificando ofertas disponibles...')
  const { data: oferResult, error: eOfer } = await supabase
    .from('precios_actuales')
    .select('producto_id, en_oferta, descuento_pct')
    .eq('en_oferta', true)
    .order('descuento_pct', { ascending: false })
    .limit(5)
  if (eOfer) fail('verificacion', eOfer)
  ok(`${oferResult.length} ofertas activas en la vista`)
  console.log('\n  Top 5 descuentos:')
  oferResult.forEach(o => console.log(`    producto ${o.producto_id}: -${o.descuento_pct}%`))

  console.log('\n✅ Seed completado. Recarga http://localhost:3000\n')
}

run().catch(err => { console.error('\n❌ Error inesperado:', err); process.exit(1) })

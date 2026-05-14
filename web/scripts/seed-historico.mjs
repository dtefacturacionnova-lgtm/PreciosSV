/**
 * Inserta 14 días de historial de precios para el gráfico
 * Ejecutar: node scripts/seed-historico.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../.env.local')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l.includes('=')).map(l => l.split('=').map(s => s.trim()))
)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function run() {
  console.log('\n📈 Insertando historial de precios (14 días)...\n')

  // Obtener variantes existentes con supermercado y producto
  const { data: variantes, error } = await supabase
    .from('producto_variantes')
    .select('id, sku_local, producto_id, supermercado_id')
  if (error) { console.error(error); process.exit(1) }

  const ahora = Date.now()
  const DIAS = 14
  const MS_DIA = 24 * 60 * 60 * 1000
  const inserts = []

  for (const variante of variantes) {
    // Obtener el precio actual de referencia
    const { data: precioActual } = await supabase
      .from('precios')
      .select('precio_normal, precio_oferta, en_oferta, descuento_pct, condicion_oferta')
      .eq('variante_id', variante.id)
      .order('fecha_hora', { ascending: false })
      .limit(1)
      .single()

    if (!precioActual) continue

    const baseNormal = precioActual.precio_normal
    const baseOferta = precioActual.precio_oferta

    // Generar puntos históricos con variación aleatoria realista
    for (let dia = DIAS; dia >= 1; dia--) {
      const fecha = new Date(ahora - dia * MS_DIA)

      // Variación del ±5% para simular fluctuaciones reales
      const variacion = 1 + (Math.random() - 0.5) * 0.10
      const precioNormalHist = Math.round(baseNormal * variacion * 100) / 100

      // La oferta empieza en el día 7 (mitad del período)
      const tieneOferta = baseOferta !== null && dia <= 7
      const precioOfertaHist = tieneOferta
        ? Math.round(precioNormalHist * (baseOferta / baseNormal) * 100) / 100
        : null

      inserts.push({
        variante_id:      variante.id,
        precio_normal:    precioNormalHist,
        precio_oferta:    precioOfertaHist,
        en_oferta:        tieneOferta,
        descuento_pct:    tieneOferta
          ? Math.round((precioNormalHist - precioOfertaHist) / precioNormalHist * 100 * 10) / 10
          : null,
        condicion_oferta: tieneOferta ? precioActual.condicion_oferta : null,
        disponible:       true,
        fecha_hora:       fecha.toISOString(),
      })
    }
  }

  // Insertar en lotes de 200
  let total = 0
  for (let i = 0; i < inserts.length; i += 200) {
    const lote = inserts.slice(i, i + 200)
    const { error: eIns } = await supabase.from('precios').insert(lote)
    if (eIns) { console.error('Error lote:', eIns.message) }
    else { total += lote.length }
  }
  console.log(`  ✓ ${total} registros históricos insertados`)

  // Refrescar vista
  const { error: eR } = await supabase.rpc('refrescar_precios_actuales')
  if (eR) console.error('Error refresh:', eR.message)
  else console.log('  ✓ Vista materializada refrescada')

  console.log('\n✅ Historial listo. Prueba el gráfico en /producto/1\n')
}

run().catch(e => { console.error(e); process.exit(1) })

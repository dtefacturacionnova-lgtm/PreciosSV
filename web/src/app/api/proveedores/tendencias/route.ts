/**
 * GET /api/proveedores/tendencias?dias=30
 * Evolución de precios promedio diario por marca (propias + competidores).
 * Devuelve datos en formato PuntoHistorico compatible con HistoricoChart,
 * usando el nombre de la marca como "supermercado_key".
 */
import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Paleta de colores para marcas competidoras
const PALETA_COMPETIDORES = [
  '#7C3AED', '#DC2626', '#D97706', '#059669',
  '#DB2777', '#0891B2', '#9333EA', '#EA580C', '#0D9488',
]

export async function GET(req: NextRequest) {
  try {
    const db = createServiceClient()

    const { data: pRaw } = await db
      .from('proveedores')
      .select('id,marcas,competidores')
      .limit(1)
      .single()
    const prov = pRaw as any
    if (!prov) return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 })

    const marcasPropias: string[] = prov.marcas ?? []
    const competidores:  string[] = prov.competidores ?? []
    const todasLasMarcas = [...new Set([...marcasPropias, ...competidores])]

    if (todasLasMarcas.length === 0) {
      return NextResponse.json({ historico: [], marcas: [], dias: 30 })
    }

    const { searchParams } = new URL(req.url)
    const dias  = Math.min(parseInt(searchParams.get('dias') ?? '30'), 90)
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()

    // ── 1. IDs de productos para las marcas ──────────────────────
    const { data: prodRaw } = await db
      .from('productos')
      .select('id, marca')
      .in('marca', todasLasMarcas)
      .eq('activo', true)

    const productosData   = (prodRaw as any[] | null) ?? []
    const productIds       = productosData.map((p: any) => p.id)
    const productoMarcaMap = new Map<number, string>(productosData.map((p: any) => [p.id, p.marca as string]))

    if (productIds.length === 0) {
      return NextResponse.json({ historico: [], marcas: [], dias })
    }

    // ── 2. IDs de variantes para esos productos ───────────────────
    const { data: varRaw } = await db
      .from('producto_variantes')
      .select('id, producto_id')
      .in('producto_id', productIds)
      .eq('activo', true)

    const variantes        = (varRaw as any[] | null) ?? []
    const varianteIds      = variantes.map((v: any) => v.id)
    const varianteProdMap  = new Map<number, number>(variantes.map((v: any) => [v.id, v.producto_id as number]))

    if (varianteIds.length === 0) {
      return NextResponse.json({ historico: [], marcas: [], dias })
    }

    // ── 3. Historial de precios ───────────────────────────────────
    const { data: preciosRaw } = await db
      .from('precios')
      .select('variante_id, precio_normal, precio_oferta, fecha_hora')
      .in('variante_id', varianteIds)
      .gte('fecha_hora', desde)
      .order('fecha_hora', { ascending: true })

    // ── 4. Agregar por marca + día ────────────────────────────────
    const agregado: Record<string, Record<string, { sum: number; count: number }>> = {}

    for (const p of (preciosRaw as any[] | null) ?? []) {
      const productoId = varianteProdMap.get(p.variante_id as number)
      if (productoId === undefined) continue
      const marca = productoMarcaMap.get(productoId)
      if (!marca) continue

      const fecha          = (p.fecha_hora as string).split('T')[0]
      const precioEfectivo = +(p.precio_oferta ?? p.precio_normal)

      if (!agregado[marca])        agregado[marca] = {}
      if (!agregado[marca][fecha]) agregado[marca][fecha] = { sum: 0, count: 0 }
      agregado[marca][fecha].sum   += precioEfectivo
      agregado[marca][fecha].count += 1
    }

    // ── 5. Metadatos de marcas (colores) ─────────────────────────
    let competidorIdx = 0
    const marcasMeta = todasLasMarcas
      .filter(m => !!agregado[m])
      .map(m => {
        const esPropias = marcasPropias.includes(m)
        const color     = esPropias
          ? '#1E40AF'
          : PALETA_COMPETIDORES[competidorIdx++ % PALETA_COMPETIDORES.length]
        return { key: m, nombre: m, color, es_propio: esPropias }
      })

    // ── 6. Construir formato PuntoHistorico ───────────────────────
    // (supermercado_key ← nombre de marca, para reusar HistoricoChart)
    const historico: {
      fecha:               string
      precio_efectivo:     number
      supermercado_nombre: string
      supermercado_key:    string
      supermercado_color:  string
    }[] = []

    for (const [marca, diasData] of Object.entries(agregado)) {
      const meta = marcasMeta.find(m => m.key === marca)
      if (!meta) continue
      for (const [fecha, agg] of Object.entries(diasData)) {
        historico.push({
          fecha:               `${fecha}T12:00:00`,
          precio_efectivo:     +(agg.sum / agg.count).toFixed(2),
          supermercado_nombre: marca,
          supermercado_key:    marca,
          supermercado_color:  meta.color,
        })
      }
    }

    historico.sort((a, b) => a.fecha.localeCompare(b.fecha))

    return NextResponse.json({ historico, marcas: marcasMeta, dias })
  } catch (err) {
    console.error('[proveedores/tendencias]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

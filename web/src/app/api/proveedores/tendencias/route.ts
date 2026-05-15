/**
 * GET /api/proveedores/tendencias?dias=30
 * Evolución de precios promedio diario por marca (propias + competidores).
 *
 * Fuente de datos: proveedor_catalogo (productos propios) +
 *   proveedor_competidores_catalogo (competidores del catálogo).
 *
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

    // ── 1. Proveedor ─────────────────────────────────────────
    const { data: pRaw } = await db
      .from('proveedores')
      .select('id')
      .limit(1)
      .single()
    const prov = pRaw as any
    if (!prov) return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 })

    // ── 2. Catálogo propio (sólo items enlazados) ─────────────
    const { data: catalogoRaw } = await (db as any)
      .from('proveedor_catalogo')
      .select('id, producto_id')
      .eq('proveedor_id', prov.id)
      .eq('activo', true)
      .not('producto_id', 'is', null)

    const catalogo         = (catalogoRaw as any[] | null) ?? []
    const catalogoIds      = catalogo.map((c: any) => c.id as number)
    const propiosProdIds   = new Set<number>(catalogo.map((c: any) => c.producto_id as number))

    // ── 3. Competidores enlazados vía catálogo ────────────────
    let compProdIds: number[] = []
    if (catalogoIds.length > 0) {
      const { data: compLinksRaw } = await (db as any)
        .from('proveedor_competidores_catalogo')
        .select('competidor_producto_id')
        .in('producto_id', catalogoIds)
        .eq('activo', true)
        .not('competidor_producto_id', 'is', null)

      compProdIds = [...new Set(
        ((compLinksRaw as any[] | null) ?? []).map((c: any) => c.competidor_producto_id as number)
      )]
    }

    const allProdIds = [...new Set([...propiosProdIds, ...compProdIds])]

    if (allProdIds.length === 0) {
      return NextResponse.json({ historico: [], marcas: [], dias: 30 })
    }

    const { searchParams } = new URL(req.url)
    const dias  = Math.min(parseInt(searchParams.get('dias') ?? '30'), 90)
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()

    // ── 4. Marca de cada producto ─────────────────────────────
    const { data: prodRaw } = await db
      .from('productos')
      .select('id, marca')
      .in('id', allProdIds)
      .eq('activo', true)

    const productosData    = (prodRaw as any[] | null) ?? []
    const productIds       = productosData.map((p: any) => p.id as number)
    const productoMarcaMap = new Map<number, string>(
      productosData.map((p: any) => [p.id, p.marca as string])
    )

    // Clasificar marcas: propias vs. competidoras
    const marcasPropias = new Set<string>()
    const marcasComp    = new Set<string>()
    for (const p of productosData) {
      if (propiosProdIds.has(p.id)) marcasPropias.add(p.marca)
      else                           marcasComp.add(p.marca)
    }

    if (productIds.length === 0) {
      return NextResponse.json({ historico: [], marcas: [], dias })
    }

    // ── 5. Variantes activas ──────────────────────────────────
    const { data: varRaw } = await db
      .from('producto_variantes')
      .select('id, producto_id')
      .in('producto_id', productIds)
      .eq('activo', true)

    const variantes       = (varRaw as any[] | null) ?? []
    const varianteIds     = variantes.map((v: any) => v.id as number)
    const varianteProdMap = new Map<number, number>(
      variantes.map((v: any) => [v.id, v.producto_id as number])
    )

    if (varianteIds.length === 0) {
      return NextResponse.json({ historico: [], marcas: [], dias })
    }

    // ── 6. Historial de precios ───────────────────────────────
    const { data: preciosRaw } = await db
      .from('precios')
      .select('variante_id, precio_normal, precio_oferta, fecha_hora')
      .in('variante_id', varianteIds)
      .gte('fecha_hora', desde)
      .order('fecha_hora', { ascending: true })

    // ── 7. Agregar por marca + día ────────────────────────────
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

    // ── 8. Metadatos de marcas ────────────────────────────────
    let competidorIdx = 0
    const todasLasMarcas = [...new Set([...marcasPropias, ...marcasComp])]
    const marcasMeta = todasLasMarcas
      .filter(m => !!agregado[m])
      .map(m => {
        const esPropias = marcasPropias.has(m)
        const color     = esPropias
          ? '#1E40AF'
          : PALETA_COMPETIDORES[competidorIdx++ % PALETA_COMPETIDORES.length]
        return { key: m, nombre: m, color, es_propio: esPropias }
      })

    // ── 9. Construir formato PuntoHistorico ───────────────────
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

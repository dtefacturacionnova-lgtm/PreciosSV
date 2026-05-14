/**
 * GET /api/proveedores/anomalias
 * Detecta cambios de precio inusuales en los últimos 7 días comparados
 * contra los 7 días previos (baseline).
 * Criterios: cambio absoluto > 2σ  O  cambio relativo > 15%
 */
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
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
      return NextResponse.json({ anomalias: [], total: 0, sin_historial: true })
    }

    // Ventana de 14 días: días 0-6 = baseline, días 7-13 = recientes
    const ahora    = new Date()
    const hace14d  = new Date(ahora.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()
    const hace7d   = new Date(ahora.getTime() -  7 * 24 * 60 * 60 * 1000).toISOString()

    // ── 1. Productos de las marcas ────────────────────────────────
    const { data: prodRaw } = await db
      .from('productos')
      .select('id, nombre, marca, imagen_url')
      .in('marca', todasLasMarcas)
      .eq('activo', true)

    const productosData = (prodRaw as any[] | null) ?? []
    if (productosData.length === 0) {
      return NextResponse.json({ anomalias: [], total: 0, sin_historial: true })
    }

    const productoMap = new Map<number, { nombre: string; marca: string; imagen_url: string | null }>(
      productosData.map((p: any) => [p.id, { nombre: p.nombre, marca: p.marca, imagen_url: p.imagen_url ?? null }])
    )
    const productIds = productosData.map((p: any) => p.id)

    // ── 2. Variantes ──────────────────────────────────────────────
    const { data: varRaw } = await db
      .from('producto_variantes')
      .select('id, producto_id, descripcion')
      .in('producto_id', productIds)
      .eq('activo', true)

    const variantes = (varRaw as any[] | null) ?? []
    if (variantes.length === 0) {
      return NextResponse.json({ anomalias: [], total: 0, sin_historial: true })
    }

    const varianteMap = new Map<number, { producto_id: number; descripcion: string | null }>(
      variantes.map((v: any) => [v.id, { producto_id: v.producto_id, descripcion: v.descripcion ?? null }])
    )
    const varianteIds = variantes.map((v: any) => v.id)

    // ── 3. Supermercados (para nombre y color) ────────────────────
    const { data: superRaw } = await db
      .from('supermercados')
      .select('key, nombre, color')

    const superMap = new Map<string, { nombre: string; color: string }>(
      ((superRaw as any[] | null) ?? []).map((s: any) => [s.key, { nombre: s.nombre, color: s.color }])
    )

    // ── 4. Precios de los últimos 14 días ─────────────────────────
    const { data: preciosRaw } = await db
      .from('precios')
      .select('variante_id, precio_normal, precio_oferta, fecha_hora, supermercado_key')
      .in('variante_id', varianteIds)
      .gte('fecha_hora', hace14d)
      .order('fecha_hora', { ascending: true })

    const precios = (preciosRaw as any[] | null) ?? []

    // Agrupar por variante_id → supermercado_key → [ baseline[], reciente[] ]
    type GrupoPrecios = { baseline: number[]; reciente: number[] }
    const grupos = new Map<string, GrupoPrecios>()

    for (const p of precios) {
      const clave = `${p.variante_id}__${p.supermercado_key}`
      if (!grupos.has(clave)) grupos.set(clave, { baseline: [], reciente: [] })
      const g = grupos.get(clave)!
      const precioEfectivo = +(p.precio_oferta ?? p.precio_normal)
      const esReciente = p.fecha_hora >= hace7d
      if (esReciente) {
        g.reciente.push(precioEfectivo)
      } else {
        g.baseline.push(precioEfectivo)
      }
    }

    // ── 5. Detectar anomalías ─────────────────────────────────────
    function promedio(arr: number[]): number {
      return arr.reduce((s, n) => s + n, 0) / arr.length
    }

    function desviacion(arr: number[], media: number): number {
      const varianza = arr.reduce((s, n) => s + (n - media) ** 2, 0) / arr.length
      return Math.sqrt(varianza)
    }

    const anomalias: {
      variante_id:    number
      nombre:         string
      supermercado:   string
      color:          string
      marca:          string
      es_propio:      boolean
      precio_anterior: number
      precio_actual:   number
      cambio_pct:      number
      tipo:           'subida_brusca' | 'bajada_brusca'
      detectado_en:   string
    }[] = []

    for (const [clave, g] of grupos) {
      if (g.baseline.length < 3 || g.reciente.length < 1) continue

      const [varianteIdStr, supKey] = clave.split('__')
      const varianteId = +varianteIdStr

      const mediaBase = promedio(g.baseline)
      const sigma     = desviacion(g.baseline, mediaBase)
      const mediaRec  = promedio(g.reciente)

      const cambioPct   = +((mediaRec - mediaBase) / mediaBase * 100).toFixed(1)
      const cambioAbso  = Math.abs(mediaRec - mediaBase)

      const umbralSigma = sigma > 0 && cambioAbso > 2 * sigma
      const umbralPct   = Math.abs(cambioPct) > 15

      if (!umbralSigma && !umbralPct) continue

      const varInfo    = varianteMap.get(varianteId)
      if (!varInfo) continue
      const prodInfo   = productoMap.get(varInfo.producto_id)
      if (!prodInfo) continue
      const superInfo  = superMap.get(supKey)

      const nombre = varInfo.descripcion
        ? `${prodInfo.nombre} — ${varInfo.descripcion}`
        : prodInfo.nombre

      anomalias.push({
        variante_id:     varianteId,
        nombre,
        supermercado:    superInfo?.nombre ?? supKey,
        color:           superInfo?.color  ?? '#94A3B8',
        marca:           prodInfo.marca,
        es_propio:       marcasPropias.includes(prodInfo.marca),
        precio_anterior: +mediaBase.toFixed(2),
        precio_actual:   +mediaRec.toFixed(2),
        cambio_pct:      cambioPct,
        tipo:            cambioPct > 0 ? 'subida_brusca' : 'bajada_brusca',
        detectado_en:    ahora.toISOString(),
      })
    }

    // Ordenar por magnitud de cambio (descendente)
    anomalias.sort((a, b) => Math.abs(b.cambio_pct) - Math.abs(a.cambio_pct))

    // Si no hay ningún precio con suficiente historial → sin_historial
    const hayHistorial = [...grupos.values()].some(g => g.baseline.length >= 3)
    if (!hayHistorial) {
      return NextResponse.json({ anomalias: [], total: 0, sin_historial: true })
    }

    return NextResponse.json({ anomalias, total: anomalias.length })
  } catch (err) {
    console.error('[proveedores/anomalias]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

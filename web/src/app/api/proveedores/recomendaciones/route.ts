/**
 * GET /api/proveedores/recomendaciones
 * Genera recomendaciones de pricing basadas en posición del precio propio
 * vs. competidores de LA MISMA CATEGORÍA (comparación por categoría).
 * Fallback al pool global si no hay competidores en la misma categoría.
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

    if (marcasPropias.length === 0 || competidores.length === 0) {
      return NextResponse.json({ recomendaciones: [], total: 0 })
    }

    // ── 1. Productos propios con categoria_id ─────────────────────
    const { data: prodPropiosRaw } = await db
      .from('productos')
      .select('id, nombre, imagen_url, marca, categoria_id')
      .in('marca', marcasPropias)
      .eq('activo', true)

    const prodPropios = (prodPropiosRaw as any[] | null) ?? []
    if (prodPropios.length === 0) {
      return NextResponse.json({ recomendaciones: [], total: 0 })
    }

    // ── 2. Variantes de productos propios ─────────────────────────
    const propiosIds = prodPropios.map((p: any) => p.id)
    const { data: varPropiosRaw } = await db
      .from('producto_variantes')
      .select('id, producto_id')
      .in('producto_id', propiosIds)
      .eq('activo', true)

    const varPropios    = (varPropiosRaw as any[] | null) ?? []
    const varPropiosIds = varPropios.map((v: any) => v.id)
    const varPropiosMap = new Map<number, number>(
      varPropios.map((v: any) => [v.id, v.producto_id])
    )

    // ── 3. Precios actuales de productos propios ──────────────────
    const { data: preciosPropiosRaw } = await db
      .from('precios_actuales')
      .select('variante_id, precio_normal, precio_oferta')
      .in('variante_id', varPropiosIds)

    // Precio efectivo promedio por producto_id
    const precioPorProducto = new Map<number, number[]>()
    for (const pp of (preciosPropiosRaw as any[] | null) ?? []) {
      const prodId = varPropiosMap.get(pp.variante_id as number)
      if (prodId === undefined) continue
      const precio = +(pp.precio_oferta ?? pp.precio_normal)
      if (!precioPorProducto.has(prodId)) precioPorProducto.set(prodId, [])
      precioPorProducto.get(prodId)!.push(precio)
    }

    // ── 4. Productos competidores con categoria_id ────────────────
    const { data: prodCompRaw } = await db
      .from('productos')
      .select('id, marca, categoria_id')
      .in('marca', competidores)
      .eq('activo', true)

    const prodComp    = (prodCompRaw as any[] | null) ?? []
    const compIds     = prodComp.map((p: any) => p.id)

    // Map: producto_id → categoria_id para competidores
    const compCatMap = new Map<number, number | null>(
      prodComp.map((p: any) => [p.id, p.categoria_id ?? null])
    )

    // ── 5. Variantes y precios de competidores ────────────────────
    const { data: varCompRaw } = await db
      .from('producto_variantes')
      .select('id, producto_id')
      .in('producto_id', compIds)
      .eq('activo', true)

    const varComp    = (varCompRaw as any[] | null) ?? []
    const varCompIds = varComp.map((v: any) => v.id)
    const varCompMap = new Map<number, number>(
      varComp.map((v: any) => [v.id, v.producto_id])
    )

    const { data: preciosCompRaw } = await db
      .from('precios_actuales')
      .select('variante_id, precio_normal, precio_oferta')
      .in('variante_id', varCompIds)

    // Precios por producto_id (competidor)
    const preciosCompPorProducto = new Map<number, number[]>()
    for (const pc of (preciosCompRaw as any[] | null) ?? []) {
      const prodId = varCompMap.get(pc.variante_id as number)
      if (prodId === undefined) continue
      const precio = +(pc.precio_oferta ?? pc.precio_normal)
      if (!preciosCompPorProducto.has(prodId)) preciosCompPorProducto.set(prodId, [])
      preciosCompPorProducto.get(prodId)!.push(precio)
    }

    // ── 6. Precios de competidores agrupados por categoría ────────
    // categoria_id → flat array of prices from all competitors in that category
    const preciosCompPorCategoria = new Map<number, number[]>()
    // También un pool global (fallback)
    const preciosCompGlobal: number[] = []

    for (const [prodId, precios] of preciosCompPorProducto.entries()) {
      const catId = compCatMap.get(prodId)
      preciosCompGlobal.push(...precios)
      if (catId !== null && catId !== undefined) {
        if (!preciosCompPorCategoria.has(catId)) preciosCompPorCategoria.set(catId, [])
        preciosCompPorCategoria.get(catId)!.push(...precios)
      }
    }

    if (preciosCompGlobal.length === 0) {
      return NextResponse.json({ recomendaciones: [], total: 0 })
    }

    // Pre-compute global stats (fallback)
    const globalMin  = Math.min(...preciosCompGlobal)
    const globalMax  = Math.max(...preciosCompGlobal)
    const globalProm = +(preciosCompGlobal.reduce((s, n) => s + n, 0) / preciosCompGlobal.length).toFixed(2)

    // ── 7. Generar recomendación por producto propio ──────────────
    const recomendaciones: {
      producto_id:             number
      nombre:                  string
      imagen_url:              string | null
      precio_propio_actual:    number
      precio_mercado_min:      number
      precio_mercado_promedio: number
      precio_mercado_max:      number
      recomendacion:           string
      accion:                  'bajar' | 'subir' | 'mantener'
      prioridad:               'alta' | 'media' | 'baja'
      impacto_estimado:        string
      comparacion_tipo:        'categoria' | 'global'
    }[] = []

    for (const prod of prodPropios) {
      const preciosArray = precioPorProducto.get(prod.id)
      if (!preciosArray || preciosArray.length === 0) continue

      const precioPropio = +(preciosArray.reduce((s, n) => s + n, 0) / preciosArray.length).toFixed(2)

      // Elegir pool de referencia: categoría propia → fallback global
      const catId = prod.categoria_id ?? null
      const preciosRef = (catId !== null && (preciosCompPorCategoria.get(catId)?.length ?? 0) >= 2)
        ? preciosCompPorCategoria.get(catId)!
        : preciosCompGlobal
      const comparacionTipo: 'categoria' | 'global' = (catId !== null && (preciosCompPorCategoria.get(catId)?.length ?? 0) >= 2)
        ? 'categoria'
        : 'global'

      const mercadoMin  = Math.min(...preciosRef)
      const mercadoMax  = Math.max(...preciosRef)
      const mercadoProm = +(preciosRef.reduce((s, n) => s + n, 0) / preciosRef.length).toFixed(2)

      const gapVsMin  = (precioPropio - mercadoMin)  / mercadoMin  * 100
      const gapVsProm = (precioPropio - mercadoProm) / mercadoProm * 100

      let recomendacion:   string
      let accion:          'bajar' | 'subir' | 'mantener'
      let prioridad:       'alta' | 'media' | 'baja'
      let impactoEstimado: string

      if (precioPropio > mercadoMin * 1.15) {
        const pct = +gapVsMin.toFixed(0)
        accion          = 'bajar'
        recomendacion   = `Precio un ${pct}% sobre el mínimo ${comparacionTipo === 'categoria' ? 'de la categoría' : 'del mercado'} ($${mercadoMin.toFixed(2)})`
        prioridad       = pct >= 30 ? 'alta' : pct >= 15 ? 'media' : 'baja'
        impactoEstimado = `Recuperar hasta ${Math.min(pct, 30)}% de share`
      } else if (precioPropio < mercadoMin) {
        const margen = +(mercadoMin - precioPropio).toFixed(2)
        accion          = 'subir'
        recomendacion   = `Por debajo del mínimo — podrías subir hasta $${mercadoMin.toFixed(2)} (+$${margen})`
        prioridad       = margen > 2 ? 'alta' : margen > 0.5 ? 'media' : 'baja'
        impactoEstimado = `Ganancia estimada: $${margen} por unidad`
      } else {
        const absPctProm = Math.abs(gapVsProm)
        accion          = 'mantener'
        recomendacion   = absPctProm <= 5
          ? `Precio alineado con el ${comparacionTipo === 'categoria' ? 'promedio de la categoría' : 'mercado'}`
          : `En rango del ${comparacionTipo === 'categoria' ? 'mercado por categoría' : 'mercado'} (${gapVsProm > 0 ? '+' : ''}${gapVsProm.toFixed(0)}% vs promedio)`
        prioridad       = 'baja'
        impactoEstimado = 'Mantener posición'
      }

      recomendaciones.push({
        producto_id:             prod.id,
        nombre:                  prod.nombre,
        imagen_url:              prod.imagen_url ?? null,
        precio_propio_actual:    precioPropio,
        precio_mercado_min:      +mercadoMin.toFixed(2),
        precio_mercado_promedio: mercadoProm,
        precio_mercado_max:      +mercadoMax.toFixed(2),
        recomendacion,
        accion,
        prioridad,
        impacto_estimado:        impactoEstimado,
        comparacion_tipo:        comparacionTipo,
      })
    }

    const prioridadOrd = { alta: 0, media: 1, baja: 2 }
    recomendaciones.sort((a, b) => prioridadOrd[a.prioridad] - prioridadOrd[b.prioridad])

    return NextResponse.json({ recomendaciones, total: recomendaciones.length })
  } catch (err) {
    console.error('[proveedores/recomendaciones]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

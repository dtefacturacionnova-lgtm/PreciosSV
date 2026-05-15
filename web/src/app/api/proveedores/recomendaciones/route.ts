/**
 * GET /api/proveedores/recomendaciones
 * Genera recomendaciones de pricing para cada item del catálogo propio.
 *
 * Fuente de datos:
 *   - Precios propios: pvp_sugerido del catálogo (lo que el proveedor controla).
 *     Si no hay pvp_sugerido, usa el precio scrapeado promedio del producto enlazado.
 *   - Precios de mercado: precios_actuales de los competidores enlazados via
 *     proveedor_competidores_catalogo (competidor_producto_id).
 *
 * Criterios:
 *   - precio > mercado_min × 1.15  → bajar (alta ≥30%, media ≥15%)
 *   - precio < mercado_min         → subir
 *   - en rango                     → mantener
 *
 * NOTE: precios_actuales is a materialized view — PostgREST cannot infer FK relationships.
 * All joins are resolved manually.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
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

    // ── 2. Catálogo propio completo (con o sin producto_id) ───
    const { data: catalogoRaw } = await (db as any)
      .from('proveedor_catalogo')
      .select('id, nombre, imagen_url, pvp_sugerido, producto_id')
      .eq('proveedor_id', prov.id)
      .eq('activo', true)

    const catalogo    = (catalogoRaw as any[] | null) ?? []
    const catalogoIds = catalogo.map((c: any) => c.id as number)

    if (catalogoIds.length === 0) {
      return NextResponse.json({ recomendaciones: [], total: 0 })
    }

    // ── 3. Competidores enlazados vía catálogo ────────────────
    const { data: compLinksRaw } = await (db as any)
      .from('proveedor_competidores_catalogo')
      .select('id, producto_id, competidor_producto_id')
      .in('producto_id', catalogoIds)
      .eq('activo', true)
      .not('competidor_producto_id', 'is', null)

    const compLinks = (compLinksRaw as any[] | null) ?? []

    // Map: catalog_id → [competidor_producto_ids]
    const compsByCatalogo = new Map<number, number[]>()
    for (const link of compLinks) {
      if (!compsByCatalogo.has(link.producto_id)) compsByCatalogo.set(link.producto_id, [])
      compsByCatalogo.get(link.producto_id)!.push(link.competidor_producto_id)
    }

    // Solo items con al menos un competidor enlazado
    const catalogoConComp = catalogo.filter((c: any) => compsByCatalogo.has(c.id))
    if (catalogoConComp.length === 0) {
      return NextResponse.json({ recomendaciones: [], total: 0 })
    }

    // ── 4. Todos los producto_ids necesarios ──────────────────
    const propiosProdIds = catalogo
      .filter((c: any) => c.producto_id != null)
      .map((c: any) => c.producto_id as number)

    const compProdIds = [...new Set(compLinks.map((l: any) => l.competidor_producto_id as number))]
    const allProdIds  = [...new Set([...propiosProdIds, ...compProdIds])]

    // ── 5. Variantes activas ──────────────────────────────────
    const preciosPorProducto = new Map<number, number[]>()

    if (allProdIds.length > 0) {
      const { data: varRaw } = await db
        .from('producto_variantes')
        .select('id, producto_id')
        .in('producto_id', allProdIds)
        .eq('activo', true)

      const variantes  = (varRaw as any[] | null) ?? []
      const varProdMap = new Map<number, number>(
        variantes.map((v: any) => [v.id, v.producto_id as number])
      )
      const allVarIds = variantes.map((v: any) => v.id as number)

      if (allVarIds.length > 0) {
        // ── 6. Precios actuales ───────────────────────────────
        const { data: preciosRaw } = await db
          .from('precios_actuales')
          .select('variante_id, precio_normal, precio_oferta')
          .in('variante_id', allVarIds)

        for (const p of (preciosRaw as any[] | null) ?? []) {
          const prodId = varProdMap.get(p.variante_id as number)
          if (prodId === undefined) continue
          const precio = +(p.precio_oferta ?? p.precio_normal)
          if (!preciosPorProducto.has(prodId)) preciosPorProducto.set(prodId, [])
          preciosPorProducto.get(prodId)!.push(precio)
        }
      }
    }

    // ── 7. Generar recomendación por item del catálogo ────────
    const recomendaciones: {
      catalogo_id:             number
      nombre:                  string
      imagen_url:              string | null
      precio_propio_actual:    number
      pvp_sugerido:            number | null
      precio_source:           'pvp_sugerido' | 'scrapeado'
      precio_mercado_min:      number
      precio_mercado_promedio: number
      precio_mercado_max:      number
      recomendacion:           string
      accion:                  'bajar' | 'subir' | 'mantener'
      prioridad:               'alta' | 'media' | 'baja'
      impacto_estimado:        string
      competidores_count:      number
    }[] = []

    for (const cat of catalogoConComp) {
      const compIds = compsByCatalogo.get(cat.id as number) ?? []

      // Precios de mercado: todos los precios scrapeados de los competidores enlazados
      const preciosComp: number[] = []
      for (const compProdId of compIds) {
        preciosComp.push(...(preciosPorProducto.get(compProdId) ?? []))
      }

      if (preciosComp.length === 0) continue

      // Precio propio: PVP sugerido (primario) → precio scrapeado (fallback)
      let precioPropio: number | null = null
      let precioSource: 'pvp_sugerido' | 'scrapeado' = 'pvp_sugerido'

      if (cat.pvp_sugerido != null) {
        precioPropio = +cat.pvp_sugerido
        precioSource = 'pvp_sugerido'
      } else if (cat.producto_id != null) {
        const propios = preciosPorProducto.get(cat.producto_id as number) ?? []
        if (propios.length > 0) {
          precioPropio = +(propios.reduce((s: number, n: number) => s + n, 0) / propios.length).toFixed(2)
          precioSource = 'scrapeado'
        }
      }

      if (precioPropio === null) continue

      const mercadoMin  = +Math.min(...preciosComp).toFixed(2)
      const mercadoMax  = +Math.max(...preciosComp).toFixed(2)
      const mercadoProm = +(preciosComp.reduce((s, n) => s + n, 0) / preciosComp.length).toFixed(2)

      const gapVsMin  = (precioPropio - mercadoMin)  / mercadoMin  * 100
      const gapVsProm = (precioPropio - mercadoProm) / mercadoProm * 100

      const labelPrecio = precioSource === 'pvp_sugerido' ? 'PVP sugerido' : 'Precio'

      let recomendacion:   string
      let accion:          'bajar' | 'subir' | 'mantener'
      let prioridad:       'alta' | 'media' | 'baja'
      let impactoEstimado: string

      if (precioPropio > mercadoMin * 1.15) {
        const pct  = +gapVsMin.toFixed(0)
        accion          = 'bajar'
        recomendacion   = `${labelPrecio} un ${pct}% sobre el mínimo del mercado ($${mercadoMin.toFixed(2)})`
        prioridad       = pct >= 30 ? 'alta' : pct >= 15 ? 'media' : 'baja'
        impactoEstimado = `Recuperar hasta ${Math.min(pct, 30)}% de share`
      } else if (precioPropio < mercadoMin) {
        const margen    = +(mercadoMin - precioPropio).toFixed(2)
        accion          = 'subir'
        recomendacion   = `Por debajo del mínimo — podrías subir hasta $${mercadoMin.toFixed(2)} (+$${margen})`
        prioridad       = margen > 2 ? 'alta' : margen > 0.5 ? 'media' : 'baja'
        impactoEstimado = `Ganancia estimada: $${margen} por unidad`
      } else {
        const absPctProm = Math.abs(gapVsProm)
        accion          = 'mantener'
        recomendacion   = absPctProm <= 5
          ? 'Precio alineado con el promedio del mercado'
          : `En rango del mercado (${gapVsProm > 0 ? '+' : ''}${gapVsProm.toFixed(0)}% vs promedio)`
        prioridad       = 'baja'
        impactoEstimado = 'Mantener posición'
      }

      recomendaciones.push({
        catalogo_id:             cat.id as number,
        nombre:                  cat.nombre,
        imagen_url:              cat.imagen_url ?? null,
        precio_propio_actual:    +precioPropio.toFixed(2),
        pvp_sugerido:            cat.pvp_sugerido != null ? +cat.pvp_sugerido : null,
        precio_source:           precioSource,
        precio_mercado_min:      mercadoMin,
        precio_mercado_promedio: mercadoProm,
        precio_mercado_max:      mercadoMax,
        recomendacion,
        accion,
        prioridad,
        impacto_estimado:        impactoEstimado,
        competidores_count:      compIds.length,
      })
    }

    const prioridadOrd: Record<string, number> = { alta: 0, media: 1, baja: 2 }
    recomendaciones.sort((a, b) => prioridadOrd[a.prioridad] - prioridadOrd[b.prioridad])

    return NextResponse.json({ recomendaciones, total: recomendaciones.length })
  } catch (err) {
    console.error('[proveedores/recomendaciones]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

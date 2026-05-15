/**
 * GET /api/proveedores/riesgo
 * F3 — Score de Riesgo Competitivo + Penetración de Mercado
 *
 * Para cada item del catálogo calcula:
 *   • gap_pct = (pvp_sugerido − precio_mercado_avg) / precio_mercado_avg × 100
 *     > 0  → mis productos son más caros que el mercado (riesgo de perder share)
 *     < 0  → soy más barato que el mercado (ventaja competitiva)
 *   • riesgo: 'alto' | 'medio' | 'bajo' | 'ventaja' | 'sin_datos'
 *   • dumping: competidor con precio < 70% del promedio del mercado Y < 60% del pvp
 *
 * Métricas de penetración:
 *   • cobertura_pct: % de items del catálogo enlazados a productos scrapeados
 *   • competidores_pct: % de items con al menos un competidor enlazado
 *
 * NOTE: precios_actuales is a materialized view — PostgREST cannot infer FKs.
 * All joins resolved manually in code.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { getProveedorAutenticadoODev } from '@/lib/supabase/auth-proveedor'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// ─── Umbrales de riesgo ───────────────────────────────────────────────────────
const UMBRAL_ALTO   = 15   // mi PVP es 15%+ más caro → riesgo alto
const UMBRAL_MEDIO  =  5   // mi PVP es 5-15% más caro → riesgo medio
const UMBRAL_VENTAJA = -5  // mi PVP es 5%+ más barato → ventaja
const UMBRAL_DUMPING_MARKET = 0.70  // precio < 70% del avg del mercado
const UMBRAL_DUMPING_PVP    = 0.60  // precio < 60% del pvp sugerido

export async function GET() {
  try {
    // ── 1. Proveedor ──────────────────────────────────────────────────────────
    const prov = await getProveedorAutenticadoODev()
    if (!prov) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const db = createServiceClient()

    // ── 2. Todo el catálogo activo (enlazados y no enlazados) ─────────────────
    const { data: catalogoRaw } = await (db as any)
      .from('proveedor_catalogo')
      .select('id, nombre, marca, imagen_url, pvp_sugerido, producto_id, categoria, subcategoria')
      .eq('proveedor_id', prov.id)
      .eq('activo', true)
      .order('nombre')

    const catalogo = (catalogoRaw as any[] | null) ?? []
    const totalCatalogo = catalogo.length

    // Métricas de penetración
    const enlazados        = catalogo.filter((c: any) => c.producto_id !== null)
    const coberturaPct     = totalCatalogo > 0
      ? Math.round((enlazados.length / totalCatalogo) * 1000) / 10
      : 0

    if (enlazados.length === 0) {
      return NextResponse.json({
        resumen: {
          total_catalogo:      totalCatalogo,
          total_enlazados:     0,
          cobertura_pct:       0,
          con_competidores:    0,
          competidores_pct:    0,
          riesgo_alto:         0,
          riesgo_medio:        0,
          riesgo_bajo:         0,
          ventaja:             0,
          sin_datos:           totalCatalogo,
          alertas_dumping:     0,
        },
        productos:  [],
        dumping:    [],
        sin_datos:  true,
      })
    }

    const catalogoIds = catalogo.map((c: any) => c.id as number)

    // ── 3. Competidores enlazados ──────────────────────────────────────────────
    const { data: compLinksRaw } = await (db as any)
      .from('proveedor_competidores_catalogo')
      .select('id, producto_id, competidor_producto_id, competidor_nombre, competidor_marca')
      .in('producto_id', catalogoIds)
      .eq('activo', true)
      .not('competidor_producto_id', 'is', null)

    const compLinks = (compLinksRaw as any[] | null) ?? []

    // Map: catalogo_id → [{competidor_producto_id, competidor_nombre, competidor_marca}]
    type CompLink = { cpId: number; nombre: string; marca: string }
    const compsByCatalogo = new Map<number, CompLink[]>()
    for (const link of compLinks) {
      if (!compsByCatalogo.has(link.producto_id)) compsByCatalogo.set(link.producto_id, [])
      compsByCatalogo.get(link.producto_id)!.push({
        cpId:   link.competidor_producto_id,
        nombre: link.competidor_nombre || 'Competidor',
        marca:  link.competidor_marca  || '',
      })
    }

    const conCompetidores    = catalogo.filter((c: any) => compsByCatalogo.has(c.id)).length
    const competidoresPct    = totalCatalogo > 0
      ? Math.round((conCompetidores / totalCatalogo) * 1000) / 10
      : 0

    // ── 4. Recopilar todos los producto_ids a consultar ───────────────────────
    const propiosProdIds = enlazados.map((c: any) => c.producto_id as number)
    const compProdIds    = [...new Set(compLinks.map((l: any) => l.competidor_producto_id as number))]
    const allProdIds     = [...new Set([...propiosProdIds, ...compProdIds])]

    // ── 5. Variantes activas ───────────────────────────────────────────────────
    const { data: varRaw } = await db
      .from('producto_variantes')
      .select('id, producto_id, supermercado_id')
      .in('producto_id', allProdIds)
      .eq('activo', true)

    const variantes = (varRaw as any[] | null) ?? []

    // Maps: variante_id → producto_id, producto_id → variante_ids
    const varProdMap = new Map<number, number>()
    const prodVarMap = new Map<number, number[]>()
    for (const v of variantes) {
      varProdMap.set(v.id, v.producto_id)
      if (!prodVarMap.has(v.producto_id)) prodVarMap.set(v.producto_id, [])
      prodVarMap.get(v.producto_id)!.push(v.id)
    }

    const allVarIds = variantes.map((v: any) => v.id as number)

    // ── 6. Precios actuales ────────────────────────────────────────────────────
    let preciosPorProducto = new Map<number, { supermercado_id: number; precio: number }[]>()

    if (allVarIds.length > 0) {
      const { data: preciosRaw } = await db
        .from('precios_actuales')
        .select('variante_id, supermercado_id, precio_normal, precio_oferta')
        .in('variante_id', allVarIds)

      for (const p of (preciosRaw as any[] | null) ?? []) {
        const prodId = varProdMap.get(p.variante_id)
        if (prodId === undefined) continue
        const precio = +(p.precio_oferta ?? p.precio_normal)
        if (!preciosPorProducto.has(prodId)) preciosPorProducto.set(prodId, [])
        preciosPorProducto.get(prodId)!.push({ supermercado_id: p.supermercado_id, precio })
      }
    }

    // ── 7. Supermercados ───────────────────────────────────────────────────────
    const superIdsNeeded = [...new Set(
      [...preciosPorProducto.values()].flat().map(p => p.supermercado_id)
    )]
    const superMap = new Map<number, { nombre: string; key: string }>()

    if (superIdsNeeded.length > 0) {
      const { data: superRaw } = await db
        .from('supermercados')
        .select('id, nombre, nombre_corto')
        .in('id', superIdsNeeded)
      for (const s of (superRaw as any[] | null) ?? []) {
        superMap.set(s.id, { nombre: s.nombre, key: s.nombre_corto })
      }
    }

    // ── 8. Calcular riesgo por item del catálogo ───────────────────────────────
    type NivelRiesgo = 'alto' | 'medio' | 'bajo' | 'ventaja' | 'sin_datos'

    interface ProductoRiesgo {
      catalogo_id:        number
      nombre:             string
      marca:              string | null
      imagen_url:         string | null
      categoria:          string | null
      subcategoria:       string | null
      pvp_sugerido:       number | null
      precio_propio_avg:  number | null
      precio_mercado_avg: number | null
      precio_mercado_min: number | null
      gap_pct:            number | null
      riesgo:             NivelRiesgo
      n_competidores:     number
      n_tiendas_propias:  number
    }

    interface AlertaDumping {
      catalogo_id:       number
      nombre_propio:     string
      competidor_nombre: string
      competidor_marca:  string
      precio_competidor: number
      precio_mercado_avg: number
      pvp_sugerido:      number | null
      diferencia_pct:    number
      supermercados:     string[]
    }

    const productos: ProductoRiesgo[] = []
    const dumpingAlertas: AlertaDumping[] = []

    // Contadores de riesgo
    const contRiesgo = { alto: 0, medio: 0, bajo: 0, ventaja: 0, sin_datos: 0 }

    for (const item of catalogo) {
      const catalogoId = item.id as number

      // Mis propios precios (si está enlazado)
      let preciosPropios: { supermercado_id: number; precio: number }[] = []
      if (item.producto_id) {
        preciosPropios = preciosPorProducto.get(item.producto_id) ?? []
      }
      const nTiendasPropias = preciosPropios.length
      const preciosPropiosValues = preciosPropios.map(p => p.precio)
      const precioPropioAvg = preciosPropiosValues.length > 0
        ? preciosPropiosValues.reduce((a, b) => a + b, 0) / preciosPropiosValues.length
        : null

      // Precio de referencia: pvp_sugerido o avg de mis propios precios observados
      const pvp = item.pvp_sugerido as number | null
      const precioPivote = pvp ?? precioPropioAvg

      // Precios de competidores enlazados
      const comps = compsByCatalogo.get(catalogoId) ?? []
      const preciosMercado: number[] = []
      const preciosPorComp = new Map<string, { precios: number[]; nombre: string; marca: string }>()

      for (const comp of comps) {
        const preciosComp = preciosPorProducto.get(comp.cpId) ?? []
        const valores = preciosComp.map(p => p.precio)
        preciosMercado.push(...valores)

        if (valores.length > 0) {
          const key = String(comp.cpId)
          if (!preciosPorComp.has(key)) {
            preciosPorComp.set(key, { precios: [], nombre: comp.nombre, marca: comp.marca })
          }
          preciosPorComp.get(key)!.precios.push(...valores)
        }
      }

      const precioMercadoAvg = preciosMercado.length > 0
        ? preciosMercado.reduce((a, b) => a + b, 0) / preciosMercado.length
        : null
      const precioMercadoMin = preciosMercado.length > 0
        ? Math.min(...preciosMercado)
        : null

      // Gap: (mi PVP - mercado avg) / mercado avg * 100
      let gapPct: number | null = null
      let riesgo: NivelRiesgo = 'sin_datos'

      if (precioPivote !== null && precioMercadoAvg !== null && precioMercadoAvg > 0) {
        gapPct = +((precioPivote - precioMercadoAvg) / precioMercadoAvg * 100).toFixed(1)

        if      (gapPct > UMBRAL_ALTO)    riesgo = 'alto'
        else if (gapPct > UMBRAL_MEDIO)   riesgo = 'medio'
        else if (gapPct <= UMBRAL_VENTAJA) riesgo = 'ventaja'
        else                               riesgo = 'bajo'
      } else if (comps.length > 0 && precioMercadoAvg === null) {
        riesgo = 'sin_datos'
      }

      contRiesgo[riesgo]++

      productos.push({
        catalogo_id:        catalogoId,
        nombre:             item.nombre,
        marca:              item.marca ?? null,
        imagen_url:         item.imagen_url ?? null,
        categoria:          item.categoria ?? null,
        subcategoria:       item.subcategoria ?? null,
        pvp_sugerido:       pvp,
        precio_propio_avg:  precioPropioAvg !== null ? +precioPropioAvg.toFixed(2) : null,
        precio_mercado_avg: precioMercadoAvg !== null ? +precioMercadoAvg.toFixed(2) : null,
        precio_mercado_min: precioMercadoMin !== null ? +precioMercadoMin.toFixed(2) : null,
        gap_pct:            gapPct,
        riesgo,
        n_competidores:     comps.length,
        n_tiendas_propias:  nTiendasPropias,
      })

      // ── Detección de dumping ──────────────────────────────────────────────
      if (precioMercadoAvg !== null && precioMercadoAvg > 0) {
        for (const [, info] of preciosPorComp) {
          const avgComp = info.precios.reduce((a, b) => a + b, 0) / info.precios.length
          const esDumping =
            avgComp < precioMercadoAvg * UMBRAL_DUMPING_MARKET &&
            (precioPivote === null || avgComp < precioPivote * UMBRAL_DUMPING_PVP)

          if (esDumping) {
            const diferenciaPct = +((avgComp - precioMercadoAvg) / precioMercadoAvg * 100).toFixed(1)

            // Supermercados donde aparece ese competidor a ese precio
            const superIdsComp = (preciosPorProducto.get(
              compLinks.find(l => l.competidor_nombre === info.nombre)?.competidor_producto_id ?? -1
            ) ?? []).map(p => p.supermercado_id)
            const superNombres = [...new Set(superIdsComp)]
              .map(id => superMap.get(id)?.nombre ?? '')
              .filter(Boolean)

            dumpingAlertas.push({
              catalogo_id:        catalogoId,
              nombre_propio:      item.nombre,
              competidor_nombre:  info.nombre,
              competidor_marca:   info.marca,
              precio_competidor:  +avgComp.toFixed(2),
              precio_mercado_avg: +precioMercadoAvg.toFixed(2),
              pvp_sugerido:       pvp,
              diferencia_pct:     diferenciaPct,
              supermercados:      superNombres,
            })
          }
        }
      }
    }

    // Ordenar: alto primero, luego por gap_pct desc
    productos.sort((a, b) => {
      const orden: Record<NivelRiesgo, number> = { alto: 0, medio: 1, bajo: 2, ventaja: 3, sin_datos: 4 }
      const ord = orden[a.riesgo] - orden[b.riesgo]
      if (ord !== 0) return ord
      return (b.gap_pct ?? -999) - (a.gap_pct ?? -999)
    })

    return NextResponse.json({
      resumen: {
        total_catalogo:   totalCatalogo,
        total_enlazados:  enlazados.length,
        cobertura_pct:    coberturaPct,
        con_competidores: conCompetidores,
        competidores_pct: competidoresPct,
        riesgo_alto:      contRiesgo.alto,
        riesgo_medio:     contRiesgo.medio,
        riesgo_bajo:      contRiesgo.bajo,
        ventaja:          contRiesgo.ventaja,
        sin_datos:        contRiesgo.sin_datos,
        alertas_dumping:  dumpingAlertas.length,
      },
      productos,
      dumping: dumpingAlertas,
      sin_datos: productos.length === 0,
    })

  } catch (err: any) {
    console.error('[/api/proveedores/riesgo]', err)
    return NextResponse.json({ error: err.message ?? 'Error interno' }, { status: 500 })
  }
}

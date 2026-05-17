/**
 * GET /api/proveedores/promociones?dias=60
 * F3 — Trade Promotion Analytics
 *
 * Analiza los patrones de promoción de los competidores enlazados al catálogo:
 *   • Frecuencia de oferta (% de registros históricos con en_oferta=true)
 *   • Descuento promedio cuando están en promoción
 *   • Duración estimada de promos
 *   • Distribución por día de semana (calendar heatmap)
 *   • Por categoría: intensidad promocional
 *   • Comparativa: mis promos vs. competidores
 *
 * NOTE: precios_actuales es una vista materializada — PostgREST no infiere FKs.
 * Todos los joins se resuelven manualmente.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { getProveedorAutenticadoODev } from '@/lib/supabase/auth-proveedor'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const DIAS_DEFAULT = 60
const DIAS_MAX     = 90

const SIN_DATOS = {
  resumen:            { total_analizado: 0, promo_activa: 0, frecuencia_media_pct: 0, descuento_medio_pct: 0 },
  por_categoria:      [],
  por_competidor:     [],
  calendario_semanal: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0 },
  por_cadena:         [],
  propios:            { promo_activa: 0, frecuencia_pct: 0, descuento_avg: 0 },
  sin_datos:          true,
}

export async function GET(req: NextRequest) {
  try {
    const prov = await getProveedorAutenticadoODev()
    if (!prov) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const db = createServiceClient()

    const dias = Math.min(
      parseInt(new URL(req.url).searchParams.get('dias') ?? String(DIAS_DEFAULT)),
      DIAS_MAX
    )
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()

    // ── 1. Catálogo activo del proveedor ──────────────────────────────────────
    const { data: catalogoRaw } = await (db as any)
      .from('proveedor_catalogo')
      .select('id, nombre, marca, producto_id, categoria, subcategoria, pvp_sugerido')
      .eq('proveedor_id', prov.id)
      .eq('activo', true)

    const catalogo = (catalogoRaw as any[] | null) ?? []
    if (catalogo.length === 0) return NextResponse.json(SIN_DATOS)

    const catalogoIds  = catalogo.map((c: any) => c.id as number)
    const catalogoMap  = new Map<number, any>(catalogo.map((c: any) => [c.id, c]))

    // ── 2. Competidores enlazados ──────────────────────────────────────────────
    const { data: compLinksRaw } = await (db as any)
      .from('proveedor_competidores_catalogo')
      .select('producto_id, competidor_producto_id, competidor_nombre, competidor_marca')
      .in('producto_id', catalogoIds)
      .eq('activo', true)
      .not('competidor_producto_id', 'is', null)

    const compLinks = (compLinksRaw as any[] | null) ?? []
    if (compLinks.length === 0) return NextResponse.json({ ...SIN_DATOS, sin_datos: true })

    // Map: catalogo_id → [{ cpId, nombre, marca }]
    const compsByCatalogo = new Map<number, { cpId: number; nombre: string; marca: string }[]>()
    const compProdIds: number[] = []
    for (const link of compLinks) {
      if (!compsByCatalogo.has(link.producto_id)) compsByCatalogo.set(link.producto_id, [])
      compsByCatalogo.get(link.producto_id)!.push({
        cpId:   link.competidor_producto_id,
        nombre: link.competidor_nombre || 'Competidor',
        marca:  link.competidor_marca  || '',
      })
      compProdIds.push(link.competidor_producto_id)
    }

    const uniqCompProdIds = [...new Set(compProdIds)]

    // ── 3. Productos propios enlazados ────────────────────────────────────────
    const propiosProdIds = catalogo
      .filter((c: any) => c.producto_id !== null)
      .map((c: any) => c.producto_id as number)

    const allProdIds = [...new Set([...propiosProdIds, ...uniqCompProdIds])]

    // ── 4. Variantes ──────────────────────────────────────────────────────────
    const { data: varRaw } = await db
      .from('producto_variantes')
      .select('id, producto_id, supermercado_id')
      .in('producto_id', allProdIds)
      .eq('activo', true)

    const variantes     = (varRaw as any[] | null) ?? []
    const varProdMap    = new Map<number, number>(variantes.map((v: any) => [v.id, v.producto_id as number]))
    const varSuperMap   = new Map<number, number>(variantes.map((v: any) => [v.id, v.supermercado_id as number]))
    const prodVarMap    = new Map<number, number[]>()
    for (const v of variantes) {
      if (!prodVarMap.has(v.producto_id)) prodVarMap.set(v.producto_id, [])
      prodVarMap.get(v.producto_id)!.push(v.id)
    }

    const allVarIds = variantes.map((v: any) => v.id as number)
    if (allVarIds.length === 0) return NextResponse.json({ ...SIN_DATOS, sin_datos: true })

    // ── 5. Supermercados ───────────────────────────────────────────────────────
    const superIdsNeeded = [...new Set(variantes.map((v: any) => v.supermercado_id as number))]
    const superMap       = new Map<number, { nombre: string; key: string; color: string }>()

    if (superIdsNeeded.length > 0) {
      const { data: superRaw } = await db
        .from('supermercados')
        .select('id, nombre, nombre_corto, color_hex')
        .in('id', superIdsNeeded)
      for (const s of (superRaw as any[] | null) ?? []) {
        superMap.set(s.id, { nombre: s.nombre, key: s.nombre_corto, color: s.color_hex })
      }
    }

    // ── 6. Precios históricos (window de `dias` días) ─────────────────────────
    const { data: preciosHistRaw } = await db
      .from('precios')
      .select('variante_id, precio_normal, precio_oferta, en_oferta, descuento_pct, fecha_hora')
      .in('variante_id', allVarIds)
      .gte('fecha_hora', desde)
      .order('fecha_hora', { ascending: true })

    const preciosHist = (preciosHistRaw as any[] | null) ?? []

    // ── 7. Precios actuales (estado actual de oferta) ─────────────────────────
    const { data: preciosActRaw } = await db
      .from('precios_actuales')
      .select('variante_id, en_oferta, descuento_pct')
      .in('variante_id', allVarIds)

    const preciosAct     = (preciosActRaw as any[] | null) ?? []
    const enOfertaActMap = new Map<number, boolean>()      // variante_id → en_oferta
    const descuentoActMap = new Map<number, number | null>() // variante_id → descuento_pct
    for (const p of preciosAct) {
      enOfertaActMap.set(p.variante_id, !!p.en_oferta)
      descuentoActMap.set(p.variante_id, p.descuento_pct != null ? +p.descuento_pct : null)
    }

    // ── 8. Análisis por competidor ────────────────────────────────────────────
    // Map: competidor_producto_id → { totalReg, enPromo, descuentos[], activo }
    type CompStats = {
      cpId:         number
      nombre:       string
      marca:        string
      catalogoId:   number
      catalogoNom:  string
      categoria:    string | null
      totalReg:     number
      enPromo:      number
      descuentos:   number[]
      activoAhora:  boolean
      supermercados: Set<number>
    }

    // Unique by (cpId, catalogoId) in case same product is linked multiple catalog items
    const compStatsMap = new Map<string, CompStats>()

    for (const [catId, comps] of compsByCatalogo) {
      const catItem = catalogoMap.get(catId)
      for (const comp of comps) {
        const key = `${comp.cpId}:${catId}`
        if (!compStatsMap.has(key)) {
          compStatsMap.set(key, {
            cpId:        comp.cpId,
            nombre:      comp.nombre,
            marca:       comp.marca,
            catalogoId:  catId,
            catalogoNom: catItem?.nombre ?? '—',
            categoria:   catItem?.categoria ?? null,
            totalReg:    0,
            enPromo:     0,
            descuentos:  [],
            activoAhora: false,
            supermercados: new Set(),
          })
        }
      }
    }

    // ── 9. Historial: llenar estadísticas ─────────────────────────────────────
    const calendarioSemanal: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0 }
    const calendarioTotal:   Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0 }

    for (const p of preciosHist) {
      const prodId = varProdMap.get(p.variante_id)
      if (prodId === undefined) continue

      const superId = varSuperMap.get(p.variante_id)
      const diaSemana = String(new Date(p.fecha_hora).getDay())
      calendarioTotal[diaSemana] = (calendarioTotal[diaSemana] ?? 0) + 1

      // Es un producto propio?
      // (propiosProdIds lo necesitamos para discriminar)
      const esPropio = propiosProdIds.includes(prodId)

      // Buscar en statsMap si es competidor
      if (!esPropio) {
        for (const [key, stat] of compStatsMap) {
          if (stat.cpId === prodId) {
            stat.totalReg++
            if (p.en_oferta) {
              stat.enPromo++
              if (p.descuento_pct) stat.descuentos.push(+p.descuento_pct)
              calendarioSemanal[diaSemana] = (calendarioSemanal[diaSemana] ?? 0) + 1
            }
            if (superId !== undefined) stat.supermercados.add(superId)
          }
        }
      }
    }

    // Marcar si está activo ahora
    for (const [, stat] of compStatsMap) {
      const varIds = prodVarMap.get(stat.cpId) ?? []
      stat.activoAhora = varIds.some(vid => enOfertaActMap.get(vid) === true)
    }

    // ── 10. Analítica de propios ───────────────────────────────────────────────
    const propioVarIds = propiosProdIds.flatMap(pid => prodVarMap.get(pid) ?? [])
    let propioTotalReg = 0, propioEnPromo = 0
    const propioDescuentos: number[] = []

    for (const p of preciosHist) {
      if (!propioVarIds.includes(p.variante_id)) continue
      propioTotalReg++
      if (p.en_oferta) {
        propioEnPromo++
        if (p.descuento_pct) propioDescuentos.push(+p.descuento_pct)
      }
    }

    const propioPromoActiva = propioVarIds.filter(vid => enOfertaActMap.get(vid) === true).length
    const propioFreqPct = propioTotalReg > 0 ? +(propioEnPromo / propioTotalReg * 100).toFixed(1) : 0
    const propioDescAvg = propioDescuentos.length > 0
      ? +(propioDescuentos.reduce((a, b) => a + b, 0) / propioDescuentos.length).toFixed(1)
      : 0

    // ── 11. Construir lista de competidores ───────────────────────────────────
    const porCompetidor = Array.from(compStatsMap.values()).map(stat => {
      const freqPct = stat.totalReg > 0 ? +(stat.enPromo / stat.totalReg * 100).toFixed(1) : 0
      const descAvg = stat.descuentos.length > 0
        ? +(stat.descuentos.reduce((a, b) => a + b, 0) / stat.descuentos.length).toFixed(1)
        : 0

      // Precio actual
      const varIds = prodVarMap.get(stat.cpId) ?? []
      const descActivos = varIds
        .filter(vid => enOfertaActMap.get(vid) === true)
        .map(vid => descuentoActMap.get(vid))
        .filter((d): d is number => d !== null && d !== undefined)

      return {
        cpId:           stat.cpId,
        nombre:         stat.nombre,
        marca:          stat.marca,
        catalogo_id:    stat.catalogoId,
        catalogo_nombre: stat.catalogoNom,
        categoria:      stat.categoria,
        total_registros: stat.totalReg,
        en_promo:        stat.enPromo,
        promo_pct:       freqPct,
        descuento_avg:   descAvg,
        activo_ahora:    stat.activoAhora,
        descuento_actual: descActivos.length > 0 ? +(descActivos.reduce((a, b) => a + b, 0) / descActivos.length).toFixed(1) : null,
        supermercados:   [...stat.supermercados].map(id => superMap.get(id)?.nombre ?? '').filter(Boolean),
      }
    }).sort((a, b) => b.promo_pct - a.promo_pct)

    // ── 12. Por categoría ─────────────────────────────────────────────────────
    const catMap = new Map<string, { total: number; enPromo: number; descuentos: number[]; activos: number }>()
    for (const c of porCompetidor) {
      const cat = c.categoria ?? 'Sin categoría'
      if (!catMap.has(cat)) catMap.set(cat, { total: 0, enPromo: 0, descuentos: [], activos: 0 })
      const entry = catMap.get(cat)!
      entry.total    += c.total_registros
      entry.enPromo  += c.en_promo
      entry.descuentos.push(...Array(c.en_promo).fill(c.descuento_avg))
      if (c.activo_ahora) entry.activos++
    }

    const porCategoria = Array.from(catMap.entries()).map(([nombre, v]) => ({
      categoria:     nombre,
      total_registros: v.total,
      en_promo:      v.enPromo,
      promo_pct:     v.total > 0 ? +(v.enPromo / v.total * 100).toFixed(1) : 0,
      descuento_avg: v.descuentos.length > 0 ? +(v.descuentos.reduce((a, b) => a + b, 0) / v.descuentos.length).toFixed(1) : 0,
      activos_ahora: v.activos,
    })).sort((a, b) => b.promo_pct - a.promo_pct)

    // ── 13. Por cadena ────────────────────────────────────────────────────────
    const porCadenaMap = new Map<number, { promo: number; total: number; descuentos: number[] }>()
    for (const p of preciosHist) {
      const prodId = varProdMap.get(p.variante_id)
      if (prodId === undefined || propiosProdIds.includes(prodId)) continue
      const superId = varSuperMap.get(p.variante_id)
      if (superId === undefined) continue
      if (!porCadenaMap.has(superId)) porCadenaMap.set(superId, { promo: 0, total: 0, descuentos: [] })
      const entry = porCadenaMap.get(superId)!
      entry.total++
      if (p.en_oferta) {
        entry.promo++
        if (p.descuento_pct) entry.descuentos.push(+p.descuento_pct)
      }
    }

    const porCadena = Array.from(porCadenaMap.entries()).map(([superId, v]) => {
      const s = superMap.get(superId)
      return {
        supermercado:  s?.nombre ?? `super_${superId}`,
        color:         s?.color  ?? '#64748B',
        promo_pct:     v.total > 0 ? +(v.promo / v.total * 100).toFixed(1) : 0,
        descuento_avg: v.descuentos.length > 0 ? +(v.descuentos.reduce((a, b) => a + b, 0) / v.descuentos.length).toFixed(1) : 0,
        total_registros: v.total,
      }
    }).sort((a, b) => b.promo_pct - a.promo_pct)

    // ── 14. Calendario: normalizar a % del día más activo ─────────────────────
    const calendarioNorm: Record<string, number> = {}
    const maxCalendario = Math.max(...Object.values(calendarioSemanal), 1)
    for (const dia of ['0', '1', '2', '3', '4', '5', '6']) {
      calendarioNorm[dia] = +(((calendarioSemanal[dia] ?? 0) / maxCalendario) * 100).toFixed(0)
    }

    // ── 15. Resumen global ────────────────────────────────────────────────────
    const totalAnalizado   = porCompetidor.length
    const promoActiva      = porCompetidor.filter(c => c.activo_ahora).length
    const freqMedia        = totalAnalizado > 0
      ? +(porCompetidor.reduce((s, c) => s + c.promo_pct, 0) / totalAnalizado).toFixed(1)
      : 0
    const descuentoMedio   = porCompetidor.filter(c => c.descuento_avg > 0).length > 0
      ? +(porCompetidor.filter(c => c.descuento_avg > 0).reduce((s, c) => s + c.descuento_avg, 0) /
          porCompetidor.filter(c => c.descuento_avg > 0).length).toFixed(1)
      : 0

    return NextResponse.json({
      resumen: {
        total_analizado:    totalAnalizado,
        promo_activa:       promoActiva,
        frecuencia_media_pct: freqMedia,
        descuento_medio_pct:  descuentoMedio,
        dias_analizados:    dias,
      },
      por_categoria:      porCategoria,
      por_competidor:     porCompetidor,
      calendario_semanal: calendarioNorm,
      por_cadena:         porCadena,
      propios: {
        promo_activa:  propioPromoActiva,
        frecuencia_pct: propioFreqPct,
        descuento_avg:  propioDescAvg,
      },
      sin_datos: totalAnalizado === 0,
    })

  } catch (err: any) {
    console.error('[/api/proveedores/promociones]', err)
    return NextResponse.json({ error: err.message ?? 'Error interno' }, { status: 500 })
  }
}

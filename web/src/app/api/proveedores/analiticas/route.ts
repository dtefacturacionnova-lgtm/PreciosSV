/**
 * GET /api/proveedores/analiticas
 * Analytics de precio relativo: productos del catálogo vs. sus competidores enlazados.
 *
 * Fuente de datos: proveedor_catalogo (productos propios con producto_id) +
 *   proveedor_competidores_catalogo (con competidor_producto_id).
 *
 * Calcula desde precios_actuales:
 *   a) Índice global: promedio de (precio_propio / precio_mercado - 1) × 100 por SKU × cadena
 *   b) Distribución: SKUs por encima / en rango (±5%) / por debajo del mercado
 *   c) Por cadena: índice de precio propio vs. mercado en cada supermercado
 *   d) Top 5 gaps: productos del catálogo con mayor diferencia de precio vs. competencia
 *
 * Comparación por (catalogo_item × supermercado): precio propio del item frente al
 * promedio de precios de sus competidores enlazados en el mismo supermercado.
 *
 * NOTE: precios_actuales is a materialized view — PostgREST cannot infer FK relationships.
 * All joins are resolved manually.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const SIN_DATOS_RESP = {
  indice_global:        0,
  productos_por_encima: 0,
  productos_en_rango:   0,
  productos_por_debajo: 0,
  por_cadena:           [],
  top_gaps:             [],
  sin_datos:            true,
}

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

    // ── 2. Catálogo propio (sólo items enlazados a productos) ─
    const { data: catalogoRaw } = await (db as any)
      .from('proveedor_catalogo')
      .select('id, nombre, imagen_url, producto_id')
      .eq('proveedor_id', prov.id)
      .eq('activo', true)
      .not('producto_id', 'is', null)

    const catalogo = (catalogoRaw as any[] | null) ?? []
    if (catalogo.length === 0) return NextResponse.json(SIN_DATOS_RESP)

    const catalogoIds    = catalogo.map((c: any) => c.id as number)
    const catalogoInfoMap = new Map<number, {
      nombre: string; imagen_url: string | null; producto_id: number
    }>(
      catalogo.map((c: any) => [c.id, {
        nombre:      c.nombre,
        imagen_url:  c.imagen_url ?? null,
        producto_id: c.producto_id as number,
      }])
    )

    // ── 3. Competidores enlazados vía catálogo ────────────────
    const { data: compLinksRaw } = await (db as any)
      .from('proveedor_competidores_catalogo')
      .select('id, producto_id, competidor_producto_id')
      .in('producto_id', catalogoIds)
      .eq('activo', true)
      .not('competidor_producto_id', 'is', null)

    const compLinks = (compLinksRaw as any[] | null) ?? []

    // Map: catalogo_id → [competidor_producto_ids]
    const compsByCatalogo = new Map<number, number[]>()
    for (const link of compLinks) {
      if (!compsByCatalogo.has(link.producto_id)) compsByCatalogo.set(link.producto_id, [])
      compsByCatalogo.get(link.producto_id)!.push(link.competidor_producto_id)
    }

    // Items del catálogo que tienen al menos un competidor enlazado
    const catalogoConComp = catalogo.filter((c: any) => compsByCatalogo.has(c.id))
    if (catalogoConComp.length === 0) return NextResponse.json(SIN_DATOS_RESP)

    // ── 4. Todos los product IDs necesarios ───────────────────
    const propiosProdIds = catalogoConComp.map((c: any) => c.producto_id as number)
    const compProdIds    = [...new Set(compLinks.map((l: any) => l.competidor_producto_id as number))]
    const allProdIds     = [...new Set([...propiosProdIds, ...compProdIds])]

    // ── 5. Variantes activas ──────────────────────────────────
    const { data: varRaw } = await db
      .from('producto_variantes')
      .select('id, producto_id')
      .in('producto_id', allProdIds)
      .eq('activo', true)

    const variantes  = (varRaw as any[] | null) ?? []
    const varProdMap = new Map<number, number>(
      variantes.map((v: any) => [v.id, v.producto_id as number])
    )

    // Map: producto_id → variante_ids
    const prodVarMap = new Map<number, number[]>()
    for (const v of variantes) {
      if (!prodVarMap.has(v.producto_id)) prodVarMap.set(v.producto_id, [])
      prodVarMap.get(v.producto_id)!.push(v.id)
    }

    const allVarIds = variantes.map((v: any) => v.id as number)
    if (allVarIds.length === 0) return NextResponse.json(SIN_DATOS_RESP)

    // ── 6. Precios actuales ───────────────────────────────────
    const { data: preciosRaw } = await db
      .from('precios_actuales')
      .select('variante_id, supermercado_id, precio_normal, precio_oferta')
      .in('variante_id', allVarIds)

    const preciosData = (preciosRaw as any[] | null) ?? []
    if (preciosData.length === 0) return NextResponse.json(SIN_DATOS_RESP)

    // ── 7. Supermercados ──────────────────────────────────────
    const superIdsNeeded = [...new Set(preciosData.map((p: any) => p.supermercado_id as number))]
    const superMap = new Map<number, { key: string; nombre: string; color: string }>()

    if (superIdsNeeded.length > 0) {
      const { data: superRaw } = await db
        .from('supermercados')
        .select('id, nombre, nombre_corto, color_hex')
        .in('id', superIdsNeeded)
      for (const s of (superRaw as any[] | null) ?? []) {
        superMap.set(s.id, { key: s.nombre_corto, nombre: s.nombre, color: s.color_hex })
      }
    }

    // ── 8. Precios por producto → supermercado ────────────────
    type PriceEntry = { supermercado_id: number; precio: number }
    const preciosPorProducto = new Map<number, PriceEntry[]>()

    for (const p of preciosData) {
      const prodId = varProdMap.get(p.variante_id)
      if (prodId === undefined) continue
      const precio = +(p.precio_oferta ?? p.precio_normal)
      if (!preciosPorProducto.has(prodId)) preciosPorProducto.set(prodId, [])
      preciosPorProducto.get(prodId)!.push({ supermercado_id: p.supermercado_id, precio })
    }

    // ── 9. Índices por catalogo_item × supermercado ───────────
    type SKUIndice = {
      catalogo_id:    number
      nombre:         string
      imagen_url:     string | null
      superId:        number
      precio_propio:  number
      precio_mercado: number
      diferencia_pct: number
    }
    const skuIndices: SKUIndice[] = []

    for (const cat of catalogoConComp) {
      const catId      = cat.id as number
      const propProdId = cat.producto_id as number
      const compIds    = compsByCatalogo.get(catId) ?? []

      const propPrecios = preciosPorProducto.get(propProdId) ?? []

      // Precios propios por supermercado
      const propBySuperMap = new Map<number, number[]>()
      for (const pp of propPrecios) {
        if (!propBySuperMap.has(pp.supermercado_id)) propBySuperMap.set(pp.supermercado_id, [])
        propBySuperMap.get(pp.supermercado_id)!.push(pp.precio)
      }

      // Precios competidores por supermercado (de todos los competidores)
      const compBySuperMap = new Map<number, number[]>()
      for (const compProdId of compIds) {
        for (const cp of preciosPorProducto.get(compProdId) ?? []) {
          if (!compBySuperMap.has(cp.supermercado_id)) compBySuperMap.set(cp.supermercado_id, [])
          compBySuperMap.get(cp.supermercado_id)!.push(cp.precio)
        }
      }

      // Comparar por supermercado donde ambos tienen precio
      for (const [superId, ownPrices] of propBySuperMap) {
        const compPricesInS = compBySuperMap.get(superId) ?? []
        if (compPricesInS.length === 0) continue

        const precioPropio  = ownPrices.reduce((a, b) => a + b, 0) / ownPrices.length
        const precioMercado = compPricesInS.reduce((a, b) => a + b, 0) / compPricesInS.length
        const diferencia_pct = +((precioPropio / precioMercado - 1) * 100).toFixed(2)

        skuIndices.push({
          catalogo_id:    catId,
          nombre:         cat.nombre,
          imagen_url:     cat.imagen_url ?? null,
          superId,
          precio_propio:  +precioPropio.toFixed(2),
          precio_mercado: +precioMercado.toFixed(2),
          diferencia_pct,
        })
      }
    }

    if (skuIndices.length === 0) return NextResponse.json(SIN_DATOS_RESP)

    // ── 10. Índice global ─────────────────────────────────────
    const indice_global = +(
      skuIndices.reduce((s, x) => s + x.diferencia_pct, 0) / skuIndices.length
    ).toFixed(2)

    // ── 11. Distribución por catalog_item (colapsar cadenas) ──
    const skuPorCatalogo = new Map<number, number[]>()
    for (const s of skuIndices) {
      if (!skuPorCatalogo.has(s.catalogo_id)) skuPorCatalogo.set(s.catalogo_id, [])
      skuPorCatalogo.get(s.catalogo_id)!.push(s.diferencia_pct)
    }

    let productos_por_encima = 0, productos_en_rango = 0, productos_por_debajo = 0
    for (const indices of skuPorCatalogo.values()) {
      const avg = indices.reduce((a, b) => a + b, 0) / indices.length
      if (avg > 5)       productos_por_encima++
      else if (avg < -5) productos_por_debajo++
      else               productos_en_rango++
    }

    // ── 12. Por cadena ────────────────────────────────────────
    const porSuperMap = new Map<number, { propios: number[]; mercado: number[] }>()
    for (const s of skuIndices) {
      if (!porSuperMap.has(s.superId)) porSuperMap.set(s.superId, { propios: [], mercado: [] })
      const entry = porSuperMap.get(s.superId)!
      entry.propios.push(s.precio_propio)
      entry.mercado.push(s.precio_mercado)
    }

    const por_cadena = Array.from(porSuperMap.entries())
      .map(([superId, v]) => {
        const super_       = superMap.get(superId)
        const prom_propio  = v.propios.reduce((a, b) => a + b, 0) / v.propios.length
        const prom_mercado = v.mercado.reduce((a, b) => a + b, 0) / v.mercado.length
        const indice       = +((prom_propio / prom_mercado - 1) * 100).toFixed(2)
        return {
          supermercado:            super_?.nombre ?? `super_${superId}`,
          color:                   super_?.color  ?? '#64748B',
          precio_promedio_propio:  +prom_propio.toFixed(2),
          precio_promedio_mercado: +prom_mercado.toFixed(2),
          indice,
        }
      })
      .sort((a, b) => b.indice - a.indice)

    // ── 13. Top 5 gaps (por catalog_item) ─────────────────────
    const gapPorCatalogo = new Map<number, SKUIndice>()
    for (const s of skuIndices) {
      const prev = gapPorCatalogo.get(s.catalogo_id)
      if (!prev || Math.abs(s.diferencia_pct) > Math.abs(prev.diferencia_pct)) {
        gapPorCatalogo.set(s.catalogo_id, s)
      }
    }

    const top_gaps = Array.from(gapPorCatalogo.values())
      .sort((a, b) => Math.abs(b.diferencia_pct) - Math.abs(a.diferencia_pct))
      .slice(0, 5)
      .map(s => ({
        nombre:         s.nombre,
        precio_propio:  s.precio_propio,
        precio_mercado: s.precio_mercado,
        diferencia_pct: s.diferencia_pct,
        imagen_url:     s.imagen_url,
      }))

    return NextResponse.json({
      indice_global,
      productos_por_encima,
      productos_en_rango,
      productos_por_debajo,
      por_cadena,
      top_gaps,
      sin_datos: false,
    })
  } catch (err) {
    console.error('[proveedores/analiticas]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

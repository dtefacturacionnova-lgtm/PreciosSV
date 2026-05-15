/**
 * GET /api/proveedores/analiticas
 * Analytics de precio relativo: marcas propias vs. competidores.
 *
 * Calcula desde precios_actuales:
 *   a) Índice global: (precio_propio_prom / precio_mercado_prom - 1) * 100
 *   b) Distribución: SKUs por encima / en rango (±5%) / por debajo del mercado
 *   c) Por cadena: índice de precio propio vs. mercado en cada supermercado
 *   d) Top 5 gaps: productos con mayor diferencia de precio vs. competencia
 *
 * NOTE: precios_actuales is a materialized view — PostgREST cannot infer FK relationships
 * from it. All joins are resolved manually to avoid silent query failures.
 *
 * Grouping strategy: productos are matched by (categoria_id × supermercado_id).
 * Own-brand prices are compared against competitor prices in the SAME category and
 * supermarket. Products with no competitor pricing in their category are skipped.
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
      return NextResponse.json(SIN_DATOS_RESP)
    }

    const todasLasMarcas = [...new Set([...marcasPropias, ...competidores])]

    // ── 1. Productos de todas las marcas relevantes ───────────────
    const { data: prodRaw } = await db
      .from('productos')
      .select('id, nombre_normalizado, marca, imagen_url, categoria_id')
      .in('marca', todasLasMarcas)
      .eq('activo', true)

    const productos = (prodRaw as any[] | null) ?? []
    if (productos.length === 0) return NextResponse.json(SIN_DATOS_RESP)

    const prodInfoMap = new Map<number, {
      nombre: string; marca: string; imagen_url: string | null; categoria_id: number | null; es_propio: boolean
    }>(
      productos.map((p: any) => [p.id, {
        nombre:       p.nombre_normalizado,
        marca:        p.marca,
        imagen_url:   p.imagen_url ?? null,
        categoria_id: p.categoria_id ?? null,
        es_propio:    marcasPropias.includes(p.marca),
      }])
    )
    const allProdIds = productos.map((p: any) => p.id)

    // ── 2. Variantes activas ──────────────────────────────────────
    const { data: varRaw } = await db
      .from('producto_variantes')
      .select('id, producto_id')
      .in('producto_id', allProdIds)
      .eq('activo', true)

    const variantes  = (varRaw as any[] | null) ?? []
    const varProdMap = new Map<number, number>(
      variantes.map((v: any) => [v.id, v.producto_id])
    )
    const allVarIds  = variantes.map((v: any) => v.id)
    if (allVarIds.length === 0) return NextResponse.json(SIN_DATOS_RESP)

    // ── 3. Precios actuales (raw) ─────────────────────────────────
    const { data: preciosRaw } = await db
      .from('precios_actuales')
      .select('variante_id, supermercado_id, precio_normal, precio_oferta')
      .in('variante_id', allVarIds)

    const preciosData = (preciosRaw as any[] | null) ?? []
    if (preciosData.length === 0) return NextResponse.json(SIN_DATOS_RESP)

    // ── 4. Supermercados (para nombre y color en la respuesta) ────
    const superIdsNeeded = [...new Set(preciosData.map((p: any) => p.supermercado_id))]
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

    // ── 5. Agrupar por (categoria_id × supermercado_id) ──────────
    //   Precios propios vs. competidores separados
    type GrupoCategoria = {
      propios:       { nombre: string; imagen_url: string | null; precio: number }[]
      competidores:  number[]
    }
    // clave: `${catId}::${superId}`
    const grupos = new Map<string, GrupoCategoria>()

    for (const f of preciosData) {
      const prodId = varProdMap.get(f.variante_id)
      if (prodId === undefined) continue
      const prod = prodInfoMap.get(prodId)
      if (!prod || prod.categoria_id === null) continue

      const clave  = `${prod.categoria_id}::${f.supermercado_id}`
      const precio = (f.precio_oferta ?? f.precio_normal) as number

      if (!grupos.has(clave)) {
        grupos.set(clave, { propios: [], competidores: [] })
      }
      const g = grupos.get(clave)!

      if (prod.es_propio) {
        g.propios.push({ nombre: prod.nombre, imagen_url: prod.imagen_url, precio })
      } else {
        g.competidores.push(precio)
      }
    }

    // ── 6. Calcular índice por (categoría × cadena) ───────────────
    type SKUIndice = {
      nombre:         string
      imagen_url:     string | null
      superId:        number
      precio_propio:  number
      precio_mercado: number
      diferencia_pct: number
    }
    const skuIndices: SKUIndice[] = []

    for (const [clave, g] of grupos) {
      if (g.propios.length === 0 || g.competidores.length === 0) continue

      const superId = Number(clave.split('::')[1])
      const precioMercado = g.competidores.reduce((a, b) => a + b, 0) / g.competidores.length

      for (const p of g.propios) {
        const diferencia_pct = +((p.precio / precioMercado - 1) * 100).toFixed(2)
        skuIndices.push({
          nombre:         p.nombre,
          imagen_url:     p.imagen_url,
          superId,
          precio_propio:  +p.precio.toFixed(2),
          precio_mercado: +precioMercado.toFixed(2),
          diferencia_pct,
        })
      }
    }

    if (skuIndices.length === 0) return NextResponse.json(SIN_DATOS_RESP)

    // ── 7. Índice global ──────────────────────────────────────────
    const indice_global = +(
      skuIndices.reduce((s, x) => s + x.diferencia_pct, 0) / skuIndices.length
    ).toFixed(2)

    // ── 8. Distribución por nombre (colapsar cadenas) ─────────────
    const skuPorNombre = new Map<string, number[]>()
    for (const s of skuIndices) {
      if (!skuPorNombre.has(s.nombre)) skuPorNombre.set(s.nombre, [])
      skuPorNombre.get(s.nombre)!.push(s.diferencia_pct)
    }

    let productos_por_encima = 0, productos_en_rango = 0, productos_por_debajo = 0
    for (const indices of skuPorNombre.values()) {
      const avg = indices.reduce((a, b) => a + b, 0) / indices.length
      if (avg > 5)       productos_por_encima++
      else if (avg < -5) productos_por_debajo++
      else               productos_en_rango++
    }

    // ── 9. Por cadena ─────────────────────────────────────────────
    const porSuperMap = new Map<number, { propios: number[]; mercado: number[] }>()
    for (const s of skuIndices) {
      if (!porSuperMap.has(s.superId)) porSuperMap.set(s.superId, { propios: [], mercado: [] })
      const entry = porSuperMap.get(s.superId)!
      entry.propios.push(s.precio_propio)
      entry.mercado.push(s.precio_mercado)
    }

    const por_cadena = Array.from(porSuperMap.entries())
      .map(([superId, v]) => {
        const super_ = superMap.get(superId)
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

    // ── 10. Top 5 gaps ────────────────────────────────────────────
    const gapPorNombre = new Map<string, SKUIndice>()
    for (const s of skuIndices) {
      const prev = gapPorNombre.get(s.nombre)
      if (!prev || Math.abs(s.diferencia_pct) > Math.abs(prev.diferencia_pct)) {
        gapPorNombre.set(s.nombre, s)
      }
    }

    const top_gaps = Array.from(gapPorNombre.values())
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

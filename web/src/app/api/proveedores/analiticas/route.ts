/**
 * GET /api/proveedores/analiticas
 * Analytics de precio relativo: marcas propias vs. competidores.
 *
 * Calcula desde precios_actuales:
 *   a) Índice global: (precio_propio_prom / precio_mercado_prom - 1) * 100
 *   b) Distribución: SKUs por encima / en rango (±5%) / por debajo del mercado
 *   c) Por cadena: índice de precio propio vs. mercado en cada supermercado
 *   d) Top 5 gaps: productos con mayor diferencia de precio vs. competencia
 */
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Colores para cada supermercado (fallback si la BD no trae color)
const COLOR_FALLBACK = '#64748B'

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

    // Sin marcas propias o sin competidores → sin datos suficientes
    if (marcasPropias.length === 0 || competidores.length === 0) {
      return NextResponse.json({
        indice_global:        0,
        productos_por_encima: 0,
        productos_en_rango:   0,
        productos_por_debajo: 0,
        por_cadena:           [],
        top_gaps:             [],
        sin_datos:            true,
      })
    }

    const todasLasMarcas = [...new Set([...marcasPropias, ...competidores])]

    // ── Precios actuales de todas las marcas relevantes ────────────
    const { data: rawPrecios } = await db
      .from('precios_actuales')
      .select(`
        producto_id,
        precio_normal,
        precio_oferta,
        disponible,
        supermercados!inner(nombre, nombre_corto, color_hex),
        producto_variantes!inner(producto_id, activo),
        productos!inner(id, nombre_normalizado, marca, activo, imagen_url)
      `)
      .in('productos.marca', todasLasMarcas)
      .eq('productos.activo', true)
      .eq('producto_variantes.activo', true)

    const filas = (rawPrecios as any[] | null) ?? []

    if (filas.length === 0) {
      return NextResponse.json({
        indice_global:        0,
        productos_por_encima: 0,
        productos_en_rango:   0,
        productos_por_debajo: 0,
        por_cadena:           [],
        top_gaps:             [],
        sin_datos:            true,
      })
    }

    // ── Estructuras de agregación ──────────────────────────────────

    // precio efectivo por producto × supermercado × si es propio
    // clave: `${producto_id}::${superKey}`
    type EntradaProducto = {
      nombre:      string
      imagen_url:  string | null
      es_propio:   boolean
      superKey:    string
      precio:      number
    }
    const entradas: EntradaProducto[] = []

    for (const f of filas) {
      const marca: string = f.productos?.marca
      if (!marca) continue
      const superKey: string = f.supermercados?.nombre_corto
      if (!superKey) continue

      const esPropioFila = marcasPropias.includes(marca)
      const precioEfectivo = (f.precio_oferta ?? f.precio_normal) as number

      entradas.push({
        nombre:     f.productos?.nombre_normalizado ?? '',
        imagen_url: f.productos?.imagen_url ?? null,
        es_propio:  esPropioFila,
        superKey,
        precio:     precioEfectivo,
      })
    }

    // ── a) Precio promedio mercado y propio por (producto × cadena) ──
    // Agrupar por nombre_normalizado × superKey → propio + mercado
    type GrupoProducto = {
      nombre:     string
      imagen_url: string | null
      superKey:   string
      propios:    number[]
      mercado:    number[]   // todos (propios + competidores)
    }

    const grupos = new Map<string, GrupoProducto>()

    for (const e of entradas) {
      const clave = `${e.nombre}::${e.superKey}`
      if (!grupos.has(clave)) {
        grupos.set(clave, {
          nombre:     e.nombre,
          imagen_url: e.imagen_url,
          superKey:   e.superKey,
          propios:    [],
          mercado:    [],
        })
      }
      const g = grupos.get(clave)!
      g.mercado.push(e.precio)
      if (e.es_propio) g.propios.push(e.precio)
    }

    // ── b) Calcular índice por SKU × cadena ───────────────────────
    type SKUIndice = {
      nombre:       string
      imagen_url:   string | null
      superKey:     string
      precio_propio: number
      precio_mercado: number
      diferencia_pct: number     // (propio/mercado - 1)*100
    }
    const skuIndices: SKUIndice[] = []

    for (const g of grupos.values()) {
      if (g.propios.length === 0) continue  // no tenemos precio propio aquí
      // necesitamos competidores en este super para comparar
      const competidorPrecios = g.mercado.filter(p => !g.propios.includes(p))
      if (competidorPrecios.length === 0) continue

      const precioPropio   = g.propios.reduce((a, b) => a + b, 0) / g.propios.length
      const precioMercado  = g.mercado.reduce((a, b) => a + b, 0) / g.mercado.length
      const diferencia_pct = +((precioPropio / precioMercado - 1) * 100).toFixed(2)

      skuIndices.push({
        nombre:        g.nombre,
        imagen_url:    g.imagen_url,
        superKey:      g.superKey,
        precio_propio: +precioPropio.toFixed(2),
        precio_mercado: +precioMercado.toFixed(2),
        diferencia_pct,
      })
    }

    if (skuIndices.length === 0) {
      return NextResponse.json({
        indice_global:        0,
        productos_por_encima: 0,
        productos_en_rango:   0,
        productos_por_debajo: 0,
        por_cadena:           [],
        top_gaps:             [],
        sin_datos:            true,
      })
    }

    // ── c) Índice global ──────────────────────────────────────────
    const indice_global = +(
      skuIndices.reduce((s, x) => s + x.diferencia_pct, 0) / skuIndices.length
    ).toFixed(2)

    // ── d) Distribución ───────────────────────────────────────────
    // Deduplicar por nombre (colapsar cadenas para dar una vista de SKU global)
    const skuPorNombre = new Map<string, number[]>()
    for (const s of skuIndices) {
      if (!skuPorNombre.has(s.nombre)) skuPorNombre.set(s.nombre, [])
      skuPorNombre.get(s.nombre)!.push(s.diferencia_pct)
    }

    let productos_por_encima = 0
    let productos_en_rango   = 0
    let productos_por_debajo = 0

    for (const indices of skuPorNombre.values()) {
      const avg = indices.reduce((a, b) => a + b, 0) / indices.length
      if (avg > 5)       productos_por_encima++
      else if (avg < -5) productos_por_debajo++
      else               productos_en_rango++
    }

    // ── e) Por cadena ─────────────────────────────────────────────
    // Agrupar skuIndices por superKey
    const porSuperMap = new Map<string, { propios: number[]; mercado: number[]; color: string; nombre: string }>()

    for (const f of filas) {
      const superKey: string = f.supermercados?.nombre_corto
      const superNombre: string = f.supermercados?.nombre ?? superKey
      const color: string = f.supermercados?.color_hex ?? COLOR_FALLBACK
      if (!superKey) continue
      if (!porSuperMap.has(superKey)) {
        porSuperMap.set(superKey, { propios: [], mercado: [], color, nombre: superNombre })
      }
    }

    for (const s of skuIndices) {
      const entry = porSuperMap.get(s.superKey)
      if (!entry) continue
      entry.propios.push(s.precio_propio)
      entry.mercado.push(s.precio_mercado)
    }

    const por_cadena = Array.from(porSuperMap.entries())
      .filter(([, v]) => v.propios.length > 0)
      .map(([superKey, v]) => {
        const prom_propio  = v.propios.reduce((a, b) => a + b, 0) / v.propios.length
        const prom_mercado = v.mercado.reduce((a, b) => a + b, 0) / v.mercado.length
        const indice       = +((prom_propio / prom_mercado - 1) * 100).toFixed(2)
        return {
          supermercado:              v.nombre || superKey,
          color:                     v.color,
          precio_promedio_propio:    +prom_propio.toFixed(2),
          precio_promedio_mercado:   +prom_mercado.toFixed(2),
          indice,
        }
      })
      .sort((a, b) => b.indice - a.indice)   // más caro primero

    // ── f) Top 5 gaps (mayor brecha absoluta) ─────────────────────
    // Colapsar por nombre → mayor diferencia_pct absoluta
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

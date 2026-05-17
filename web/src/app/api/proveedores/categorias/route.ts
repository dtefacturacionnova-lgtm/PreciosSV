/**
 * GET /api/proveedores/categorias
 * F3 — Category Management Reports
 *
 * Para cada categoría presente en la base de datos calcula:
 *   • Total de productos (shelf share proxy)
 *   • Mis productos vs. total (share del proveedor)
 *   • Precio promedio del mercado y del proveedor
 *   • Índice de precio: (mio - mercado) / mercado × 100
 *   • Intensidad promocional: % de productos en oferta
 *   • Top marcas por categoría
 *   • Presencia por cadena
 *
 * Separa en dos dimensiones: por categoría (nivel 1) y por subcategoría (nivel 2).
 *
 * NOTE: precios_actuales es una vista materializada — PostgREST no infiere FKs.
 * Todos los joins se resuelven manualmente.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { getProveedorAutenticadoODev } from '@/lib/supabase/auth-proveedor'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const prov = await getProveedorAutenticadoODev()
    if (!prov) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const db = createServiceClient()

    // ── 1. Catálogo del proveedor (incluyendo no-enlazados) ───────────────────
    const { data: catalogoRaw } = await (db as any)
      .from('proveedor_catalogo')
      .select('id, nombre, marca, producto_id, categoria, subcategoria, pvp_sugerido')
      .eq('proveedor_id', prov.id)
      .eq('activo', true)

    const catalogo = (catalogoRaw as any[] | null) ?? []

    // Set de producto_ids propios
    const propiosProdIds = new Set<number>(
      catalogo.filter((c: any) => c.producto_id !== null).map((c: any) => c.producto_id as number)
    )
    // Map: producto_id → { categoria, subcategoria, pvp_sugerido }
    const propiosInfoMap = new Map<number, { categoria: string | null; subcategoria: string | null; pvp: number | null }>()
    for (const c of catalogo) {
      if (c.producto_id !== null) {
        propiosInfoMap.set(c.producto_id, {
          categoria:    c.categoria ?? null,
          subcategoria: c.subcategoria ?? null,
          pvp:          c.pvp_sugerido != null ? +c.pvp_sugerido : null,
        })
      }
    }

    // ── 2. Productos y variantes en la BD completa ────────────────────────────
    // Obtenemos todos los productos activos con su categoría
    const { data: productosRaw } = await db
      .from('productos')
      .select('id, nombre_normalizado, marca, categoria_nombre')
      .eq('activo', true)

    const productos = (productosRaw as any[] | null) ?? []
    if (productos.length === 0) {
      return NextResponse.json({ categorias: [], subcategorias: [], resumen: { total_categorias: 0, categorias_presentes: 0 }, sin_datos: true })
    }

    const productoMap = new Map<number, { nombre: string; marca: string; categoria: string | null }>(
      productos.map((p: any) => [p.id, { nombre: p.nombre_normalizado, marca: p.marca, categoria: p.categoria_nombre }])
    )
    const allProdIds = productos.map((p: any) => p.id as number)

    // ── 3. Variantes activas de todos los productos ───────────────────────────
    const { data: varRaw } = await db
      .from('producto_variantes')
      .select('id, producto_id, supermercado_id')
      .in('producto_id', allProdIds)
      .eq('activo', true)

    const variantes   = (varRaw as any[] | null) ?? []
    const varProdMap  = new Map<number, number>(variantes.map((v: any) => [v.id, v.producto_id as number]))
    const varSuperMap = new Map<number, number>(variantes.map((v: any) => [v.id, v.supermercado_id as number]))
    const allVarIds   = variantes.map((v: any) => v.id as number)

    // ── 4. Supermercados ───────────────────────────────────────────────────────
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

    // ── 5. Precios actuales de todos los productos ────────────────────────────
    if (allVarIds.length === 0) {
      return NextResponse.json({ categorias: [], subcategorias: [], resumen: { total_categorias: 0, categorias_presentes: 0 }, sin_datos: true })
    }

    const { data: preciosRaw } = await db
      .from('precios_actuales')
      .select('variante_id, supermercado_id, precio_normal, precio_oferta, en_oferta, descuento_pct')
      .in('variante_id', allVarIds)

    const precios = (preciosRaw as any[] | null) ?? []

    // ── 6. Construir mapa de precios por producto ─────────────────────────────
    type PrecioEntry = {
      supermercado_id: number
      precio:          number
      en_oferta:       boolean
      descuento_pct:   number | null
    }
    const preciosPorProducto = new Map<number, PrecioEntry[]>()

    for (const p of precios) {
      const prodId = varProdMap.get(p.variante_id)
      if (prodId === undefined) continue
      const precio = +(p.precio_oferta ?? p.precio_normal)
      if (!preciosPorProducto.has(prodId)) preciosPorProducto.set(prodId, [])
      preciosPorProducto.get(prodId)!.push({
        supermercado_id: p.supermercado_id,
        precio,
        en_oferta:       !!p.en_oferta,
        descuento_pct:   p.descuento_pct != null ? +p.descuento_pct : null,
      })
    }

    // ── 7. Agregar por categoría ───────────────────────────────────────────────
    type CatAgregado = {
      nombre:        string
      totalProdIds:  Set<number>
      propiosProdIds: Set<number>
      precios:       number[]
      propioPrecios: number[]
      enOferta:      number
      totalRegistros: number
      marcas:        Map<string, number>
      supermercados: Map<number, number>  // supId → count de productos
    }

    const catMap = new Map<string, CatAgregado>()

    for (const prod of productos) {
      const prodId   = prod.id as number
      const catNombre = (prod.categoria_nombre as string | null) ?? 'Sin categoría'
      const esPropio = propiosProdIds.has(prodId)
      const entries  = preciosPorProducto.get(prodId) ?? []

      if (!catMap.has(catNombre)) {
        catMap.set(catNombre, {
          nombre:         catNombre,
          totalProdIds:   new Set(),
          propiosProdIds: new Set(),
          precios:        [],
          propioPrecios:  [],
          enOferta:       0,
          totalRegistros: 0,
          marcas:         new Map(),
          supermercados:  new Map(),
        })
      }

      const cat = catMap.get(catNombre)!
      cat.totalProdIds.add(prodId)
      if (esPropio) cat.propiosProdIds.add(prodId)

      if (prod.marca) {
        cat.marcas.set(prod.marca, (cat.marcas.get(prod.marca) ?? 0) + 1)
      }

      for (const entry of entries) {
        cat.precios.push(entry.precio)
        cat.totalRegistros++
        if (entry.en_oferta) cat.enOferta++
        if (esPropio) cat.propioPrecios.push(entry.precio)
        if (!cat.supermercados.has(entry.supermercado_id)) cat.supermercados.set(entry.supermercado_id, 0)
        cat.supermercados.set(entry.supermercado_id, cat.supermercados.get(entry.supermercado_id)! + 1)
      }
    }

    // ── 8. Serializar categorías ───────────────────────────────────────────────
    const categorias = Array.from(catMap.values()).map(cat => {
      const totalProd       = cat.totalProdIds.size
      const miosProd        = cat.propiosProdIds.size
      const sharePct        = totalProd > 0 ? +(miosProd / totalProd * 100).toFixed(1) : 0

      const precioMercadoAvg = cat.precios.length > 0
        ? +(cat.precios.reduce((a, b) => a + b, 0) / cat.precios.length).toFixed(2)
        : null
      const precioMioAvg = cat.propioPrecios.length > 0
        ? +(cat.propioPrecios.reduce((a, b) => a + b, 0) / cat.propioPrecios.length).toFixed(2)
        : null

      const indicePrecio = (precioMioAvg !== null && precioMercadoAvg !== null && precioMercadoAvg > 0)
        ? +((precioMioAvg - precioMercadoAvg) / precioMercadoAvg * 100).toFixed(1)
        : null

      const ofertaPct = cat.totalRegistros > 0
        ? +(cat.enOferta / cat.totalRegistros * 100).toFixed(1)
        : 0

      // Top 5 marcas por recuento de productos
      const topMarcas = Array.from(cat.marcas.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([marca, count]) => ({ marca, count }))

      // Presencia por supermercado
      const porSuper = Array.from(cat.supermercados.entries()).map(([supId, count]) => ({
        supermercado: superMap.get(supId)?.nombre ?? `super_${supId}`,
        color:        superMap.get(supId)?.color  ?? '#64748B',
        count,
      })).sort((a, b) => b.count - a.count)

      return {
        nombre:                  cat.nombre,
        total_productos:         totalProd,
        mis_productos:           miosProd,
        share_pct:               sharePct,
        precio_promedio_mercado: precioMercadoAvg,
        precio_promedio_propio:  precioMioAvg,
        indice_precio:           indicePrecio,
        oferta_pct:              ofertaPct,
        top_marcas:              topMarcas,
        por_supermercado:        porSuper,
      }
    }).sort((a, b) => b.total_productos - a.total_productos)

    // ── 9. Resumen ────────────────────────────────────────────────────────────
    const categoriasPresentes = categorias.filter(c => c.mis_productos > 0)
    const mejorIndice = categoriasPresentes.filter(c => c.indice_precio !== null)
      .sort((a, b) => (a.indice_precio ?? 0) - (b.indice_precio ?? 0))[0] ?? null
    const peorIndice = categoriasPresentes.filter(c => c.indice_precio !== null)
      .sort((a, b) => (b.indice_precio ?? 0) - (a.indice_precio ?? 0))[0] ?? null

    const resumen = {
      total_categorias:     categorias.length,
      categorias_presentes: categoriasPresentes.length,
      total_productos_db:   productos.length,
      mis_productos_total:  propiosProdIds.size,
      mejor_indice: mejorIndice ? { nombre: mejorIndice.nombre, indice: mejorIndice.indice_precio } : null,
      peor_indice:  peorIndice  ? { nombre: peorIndice.nombre,  indice: peorIndice.indice_precio  } : null,
    }

    return NextResponse.json({ categorias, resumen, sin_datos: categorias.length === 0 })

  } catch (err: any) {
    console.error('[/api/proveedores/categorias]', err)
    return NextResponse.json({ error: err.message ?? 'Error interno' }, { status: 500 })
  }
}

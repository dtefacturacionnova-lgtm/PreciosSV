/**
 * GET /api/proveedores/competencia
 * Análisis comparativo: mis marcas vs. marcas competidoras
 * por supermercado — precios actuales y cobertura
 */
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const db = createServiceClient()

    const { data: pRaw } = await db
      .from('proveedores')
      .select('id,razon_social,marcas,competidores')
      .limit(1)
      .single()
    const prov = pRaw as any
    if (!prov) return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 })

    const marcasPropias: string[] = prov.marcas ?? []
    const competidores: string[] = prov.competidores ?? []
    const todasLasMarcas = [...new Set([...marcasPropias, ...competidores])]

    if (todasLasMarcas.length === 0) {
      return NextResponse.json({ marcas_propias: [], competidores: [], supermercados: [], analisis: {} })
    }

    // ── Precios actuales de todos los productos relevantes ────
    const { data: rawPrecios } = await db
      .from('precios_actuales')
      .select(`
        producto_id,
        precio_normal,
        precio_oferta,
        en_oferta,
        descuento_pct,
        disponible,
        supermercados!inner(nombre, nombre_corto, color_hex),
        producto_variantes!inner(producto_id, activo),
        productos!inner(nombre_normalizado, marca, activo, categorias(nombre, slug))
      `)
      .in('productos.marca', todasLasMarcas)
      .eq('productos.activo', true)
      .eq('producto_variantes.activo', true)

    const filas = (rawPrecios as any[] | null) ?? []

    // ── Recopilar supermercados únicos ───────────────────────
    const superMap = new Map<string, { nombre: string; color: string }>()
    for (const f of filas) {
      const s = f.supermercados
      if (s?.nombre_corto) superMap.set(s.nombre_corto, { nombre: s.nombre, color: s.color_hex })
    }
    const supermercados = Array.from(superMap.entries()).map(([key, val]) => ({ key, ...val }))

    // ── Agrupar por marca × supermercado ─────────────────────
    type MarcaStats = {
      precios:   Record<string, number[]>   // super_key → [precios efectivos]
      ofertas:   Record<string, number>     // super_key → count en oferta
      productos: number                     // total productos únicos
      categorias: Set<string>
    }
    const porMarca = new Map<string, MarcaStats>()

    for (const marca of todasLasMarcas) {
      porMarca.set(marca, { precios: {}, ofertas: {}, productos: 0, categorias: new Set() })
    }

    const productosVistos = new Map<string, Set<number>>() // marca → set de producto_id únicos

    for (const f of filas) {
      const marca: string = f.productos?.marca
      if (!marca || !porMarca.has(marca)) continue

      const superKey: string = f.supermercados?.nombre_corto
      if (!superKey) continue

      const precioEfectivo = (f.precio_oferta ?? f.precio_normal) as number
      const stats = porMarca.get(marca)!

      if (!stats.precios[superKey]) stats.precios[superKey] = []
      stats.precios[superKey].push(precioEfectivo)

      if (f.en_oferta) stats.ofertas[superKey] = (stats.ofertas[superKey] ?? 0) + 1

      if (!productosVistos.has(marca)) productosVistos.set(marca, new Set())
      productosVistos.get(marca)!.add(f.producto_id)

      const cat = f.productos?.categorias?.nombre
      if (cat) stats.categorias.add(cat)
    }

    // ── Calcular promedios y cobertura ────────────────────────
    const analisis: Record<string, {
      precio_promedio:  Record<string, number | null>
      precio_minimo:    Record<string, number | null>
      cobertura:        Record<string, number>  // # productos disponibles
      ofertas:          Record<string, number>
      total_productos:  number
      categorias:       string[]
      es_propio:        boolean
    }> = {}

    for (const [marca, stats] of porMarca.entries()) {
      const precio_promedio: Record<string, number | null> = {}
      const precio_minimo:   Record<string, number | null> = {}
      const cobertura:       Record<string, number> = {}

      for (const [sk, precios] of Object.entries(stats.precios)) {
        precio_promedio[sk] = precios.length
          ? +(precios.reduce((a, b) => a + b, 0) / precios.length).toFixed(2)
          : null
        precio_minimo[sk] = precios.length ? Math.min(...precios) : null
        cobertura[sk] = precios.length
      }

      analisis[marca] = {
        precio_promedio,
        precio_minimo,
        cobertura,
        ofertas:         stats.ofertas,
        total_productos: productosVistos.get(marca)?.size ?? 0,
        categorias:      Array.from(stats.categorias),
        es_propio:       marcasPropias.includes(marca),
      }
    }

    return NextResponse.json({
      marcas_propias: marcasPropias,
      competidores,
      supermercados,
      analisis,
    })
  } catch (err) {
    console.error('[proveedores/competencia]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

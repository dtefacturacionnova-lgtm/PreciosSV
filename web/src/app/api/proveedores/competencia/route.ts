/**
 * GET /api/proveedores/competencia
 * Análisis comparativo: mis marcas vs. marcas competidoras
 * por supermercado — precios actuales y cobertura.
 *
 * NOTE: precios_actuales is a materialized view — PostgREST cannot infer FK relationships
 * from it. All joins are resolved manually to avoid silent query failures.
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

    const marcasPropias: string[] = prov.marcas ?? []
    const competidores: string[] = prov.competidores ?? []
    const todasLasMarcas = [...new Set([...marcasPropias, ...competidores])]

    if (todasLasMarcas.length === 0) {
      return NextResponse.json({ marcas_propias: [], competidores: [], supermercados: [], analisis: {} })
    }

    // ── 1. Productos de todas las marcas relevantes ───────────────
    const { data: prodRaw } = await db
      .from('productos')
      .select('id, marca, categorias(nombre)')
      .in('marca', todasLasMarcas)
      .eq('activo', true)

    const productos = (prodRaw as any[] | null) ?? []
    if (productos.length === 0) {
      return NextResponse.json({ marcas_propias: marcasPropias, competidores, supermercados: [], analisis: {} })
    }

    const prodMarcaMap = new Map<number, string>(
      productos.map((p: any) => [p.id, p.marca as string])
    )
    const prodCatMap = new Map<number, string | null>(
      productos.map((p: any) => [p.id, (p.categorias as any)?.nombre ?? null])
    )
    const allProdIds = productos.map((p: any) => p.id)

    // ── 2. Variantes activas ──────────────────────────────────────
    const { data: varRaw } = await db
      .from('producto_variantes')
      .select('id, producto_id')
      .in('producto_id', allProdIds)
      .eq('activo', true)

    const variantes = (varRaw as any[] | null) ?? []
    const varProdMap = new Map<number, number>(
      variantes.map((v: any) => [v.id, v.producto_id])
    )
    const allVarIds = variantes.map((v: any) => v.id)

    if (allVarIds.length === 0) {
      return NextResponse.json({ marcas_propias: marcasPropias, competidores, supermercados: [], analisis: {} })
    }

    // ── 3. Precios actuales (raw, no embedded joins) ──────────────
    const { data: preciosRaw } = await db
      .from('precios_actuales')
      .select('variante_id, supermercado_id, precio_normal, precio_oferta, en_oferta')
      .in('variante_id', allVarIds)

    const preciosData = (preciosRaw as any[] | null) ?? []

    // ── 4. Supermercados ──────────────────────────────────────────
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

    // ── 5. Recopilar supermercados únicos ─────────────────────────
    const supermercados = Array.from(superMap.entries()).map(([, v]) => v)

    // ── 6. Agrupar por marca × supermercado ──────────────────────
    type MarcaStats = {
      precios:    Record<string, number[]>
      ofertas:    Record<string, number>
      categorias: Set<string>
    }
    const porMarca = new Map<string, MarcaStats>()
    for (const marca of todasLasMarcas) {
      porMarca.set(marca, { precios: {}, ofertas: {}, categorias: new Set() })
    }

    const productosVistos = new Map<string, Set<number>>()  // marca → set de producto_id únicos

    for (const f of preciosData) {
      const prodId = varProdMap.get(f.variante_id)
      if (prodId === undefined) continue

      const marca = prodMarcaMap.get(prodId)
      if (!marca || !porMarca.has(marca)) continue

      const super_ = superMap.get(f.supermercado_id)
      if (!super_) continue
      const superKey = super_.key

      const precioEfectivo = (f.precio_oferta ?? f.precio_normal) as number
      const stats = porMarca.get(marca)!

      if (!stats.precios[superKey]) stats.precios[superKey] = []
      stats.precios[superKey].push(precioEfectivo)

      if (f.en_oferta) stats.ofertas[superKey] = (stats.ofertas[superKey] ?? 0) + 1

      if (!productosVistos.has(marca)) productosVistos.set(marca, new Set())
      productosVistos.get(marca)!.add(prodId)

      const cat = prodCatMap.get(prodId)
      if (cat) stats.categorias.add(cat)
    }

    // ── 7. Calcular promedios y cobertura ─────────────────────────
    const analisis: Record<string, {
      precio_promedio:  Record<string, number | null>
      precio_minimo:    Record<string, number | null>
      cobertura:        Record<string, number>
      ofertas:          Record<string, number>
      total_productos:  number
      categorias:       string[]
      es_propio:        boolean
    }> = {}

    for (const [marca, stats] of porMarca.entries()) {
      const precio_promedio: Record<string, number | null> = {}
      const precio_minimo:   Record<string, number | null> = {}
      const cobertura:       Record<string, number>        = {}

      for (const [sk, precios] of Object.entries(stats.precios)) {
        precio_promedio[sk] = precios.length
          ? +(precios.reduce((a, b) => a + b, 0) / precios.length).toFixed(2)
          : null
        precio_minimo[sk] = precios.length ? Math.min(...precios) : null
        cobertura[sk]     = precios.length
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

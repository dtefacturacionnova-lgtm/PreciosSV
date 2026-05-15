import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// NOTE: precios_actuales is a materialized view — PostgREST cannot infer FK relationships
// from it (neither direction). All joins are resolved manually.

export async function GET() {
  try {
    const db = createServiceClient()

    const { data: proveedorRaw } = await db
      .from('proveedores')
      .select('id, razon_social, marcas')
      .limit(1)
      .single()
    const proveedor = proveedorRaw as any

    if (!proveedor) return NextResponse.json({ error: 'Proveedor no registrado' }, { status: 404 })

    const marcas: string[] = proveedor.marcas ?? []
    if (marcas.length === 0) {
      return NextResponse.json({
        proveedor: { razon_social: proveedor.razon_social, marcas: [] },
        metricas: { productos_activos: 0, productos_con_precio: 0, ofertas_activas: 0, tiendas_presencia: 0, descuento_promedio: null },
        tabla: [],
      })
    }

    // ── 1. Productos del proveedor ────────────────────────────────
    const { data: productosRaw } = await db
      .from('productos')
      .select('id, nombre_normalizado, marca, imagen_url, activo, categorias(nombre)')
      .in('marca', marcas)
      .eq('activo', true)
      .order('nombre_normalizado')

    const productosData = (productosRaw as any[] | null) ?? []
    if (productosData.length === 0) {
      return NextResponse.json({
        proveedor: { razon_social: proveedor.razon_social, marcas },
        metricas: { productos_activos: 0, productos_con_precio: 0, ofertas_activas: 0, tiendas_presencia: 0, descuento_promedio: null },
        tabla: [],
      })
    }

    const prodIds = productosData.map((p: any) => p.id)

    // ── 2. Variantes activas ──────────────────────────────────────
    const { data: varRaw } = await db
      .from('producto_variantes')
      .select('id, producto_id')
      .in('producto_id', prodIds)
      .eq('activo', true)

    const variantes  = (varRaw as any[] | null) ?? []
    const varProdMap = new Map<number, number>(variantes.map((v: any) => [v.id, v.producto_id]))
    const varIds     = variantes.map((v: any) => v.id)

    // ── 3. Precios actuales (raw) ─────────────────────────────────
    type PrecioParsed = {
      supermercado_id: number
      precio_normal:   number
      precio_oferta:   number | null
      en_oferta:       boolean
      descuento_pct:   number | null
      disponible:      boolean
    }

    // preciosPorProducto: producto_id → list of price rows
    const preciosPorProducto = new Map<number, PrecioParsed[]>()

    if (varIds.length > 0) {
      const { data: paRaw } = await db
        .from('precios_actuales')
        .select('variante_id, supermercado_id, precio_normal, precio_oferta, en_oferta, descuento_pct, disponible')
        .in('variante_id', varIds)

      for (const pa of (paRaw as any[] | null) ?? []) {
        const prodId = varProdMap.get(pa.variante_id)
        if (prodId === undefined) continue
        if (!preciosPorProducto.has(prodId)) preciosPorProducto.set(prodId, [])
        preciosPorProducto.get(prodId)!.push({
          supermercado_id: pa.supermercado_id,
          precio_normal:   +pa.precio_normal,
          precio_oferta:   pa.precio_oferta != null ? +pa.precio_oferta : null,
          en_oferta:       pa.en_oferta,
          descuento_pct:   pa.descuento_pct != null ? +pa.descuento_pct : null,
          disponible:      pa.disponible,
        })
      }
    }

    // ── 4. Supermercados (for names/colors) ───────────────────────
    const superIdsNeeded = new Set<number>()
    for (const precios of preciosPorProducto.values()) {
      for (const p of precios) superIdsNeeded.add(p.supermercado_id)
    }

    const superMap = new Map<number, { nombre: string; nombre_corto: string; color_hex: string }>()

    if (superIdsNeeded.size > 0) {
      const { data: superRaw } = await db
        .from('supermercados')
        .select('id, nombre, nombre_corto, color_hex')
        .in('id', [...superIdsNeeded])

      for (const s of (superRaw as any[] | null) ?? []) {
        superMap.set(s.id, { nombre: s.nombre, nombre_corto: s.nombre_corto, color_hex: s.color_hex })
      }
    }

    // ── 5. Métricas ───────────────────────────────────────────────
    let totalOfertas = 0
    let totalProductosConPrecio = 0
    const tiendasSet = new Set<string>()
    let sumDescuentos = 0
    let countDescuentos = 0

    for (const [, precios] of preciosPorProducto) {
      if (precios.length > 0) totalProductosConPrecio++
      for (const p of precios) {
        const s = superMap.get(p.supermercado_id)
        if (s?.nombre_corto) tiendasSet.add(s.nombre_corto)
        if (p.en_oferta) totalOfertas++
        if (p.descuento_pct) { sumDescuentos += p.descuento_pct; countDescuentos++ }
      }
    }

    const metricas = {
      productos_activos:    productosData.length,
      productos_con_precio: totalProductosConPrecio,
      ofertas_activas:      totalOfertas,
      tiendas_presencia:    tiendasSet.size,
      descuento_promedio:   countDescuentos ? +(sumDescuentos / countDescuentos).toFixed(1) : null,
    }

    // ── 6. Tabla de productos con precios por tienda ──────────────
    const tabla = productosData.map((prod: any) => {
      const precios = preciosPorProducto.get(prod.id) ?? []

      // Precio mínimo efectivo
      let precioMinVal = Infinity
      let precioMinSuperKey:   string | null = null
      let precioMinSuperNombre: string | null = null
      let precioMinSuperColor:  string | null = null

      for (const p of precios) {
        const ef = p.precio_oferta ?? p.precio_normal
        if (ef < precioMinVal) {
          precioMinVal         = ef
          const s              = superMap.get(p.supermercado_id)
          precioMinSuperKey    = s?.nombre_corto ?? null
          precioMinSuperNombre = s?.nombre       ?? null
          precioMinSuperColor  = s?.color_hex    ?? null
        }
      }

      return {
        id:                prod.id,
        nombre:            prod.nombre_normalizado,
        marca:             prod.marca,
        imagen_url:        prod.imagen_url,
        categoria:         (prod.categorias as any)?.nombre ?? null,
        precio_min:        precios.length > 0 ? +precioMinVal.toFixed(2) : null,
        en_oferta:         precios.some(p => p.en_oferta),
        descuento_max:     precios.reduce((m, p) => Math.max(m, p.descuento_pct ?? 0), 0) || null,
        tiendas:           precios.length,
        tienda_mas_barata: precioMinSuperNombre,
        color_mas_barata:  precioMinSuperColor,
        precios_por_tienda: precios.map(p => {
          const s = superMap.get(p.supermercado_id)
          return {
            supermercado:  s?.nombre       ?? null,
            key:           s?.nombre_corto ?? null,
            color:         s?.color_hex    ?? null,
            precio_normal: p.precio_normal,
            precio_oferta: p.precio_oferta,
            en_oferta:     p.en_oferta,
            descuento_pct: p.descuento_pct,
            disponible:    p.disponible,
          }
        }),
      }
    })

    return NextResponse.json({
      proveedor: { razon_social: proveedor.razon_social, marcas },
      metricas,
      tabla,
    })
  } catch (err) {
    console.error('[proveedores/dashboard]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

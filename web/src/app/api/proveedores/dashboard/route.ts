import { createServiceClient } from '@/lib/supabase/service'
import { getProveedorAutenticadoODev } from '@/lib/supabase/auth-proveedor'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// NOTE: precios_actuales is a materialized view — PostgREST cannot infer FK relationships
// from it (neither direction). All joins are resolved manually.

export async function GET() {
  try {
    // ── 1. Proveedor ──────────────────────────────────────────────
    const proveedor = await getProveedorAutenticadoODev()
    if (!proveedor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const db = createServiceClient()

    // ── 2. Catálogo propio ─────────────────────────────────────────
    const { data: catalogoRaw } = await (db as any)
      .from('proveedor_catalogo')
      .select('id, nombre, marca, imagen_url, pvp_sugerido, producto_id, categoria, subcategoria')
      .eq('proveedor_id', proveedor.id)
      .eq('activo', true)
      .order('nombre')

    const catalogo = (catalogoRaw as any[] | null) ?? []

    // Derive brand list from catalog items
    const marcas = [...new Set(
      catalogo.map((c: any) => c.marca).filter(Boolean)
    )] as string[]

    if (catalogo.length === 0) {
      return NextResponse.json({
        proveedor: { razon_social: proveedor.razon_social, marcas: [] },
        metricas: { productos_activos: 0, productos_con_precio: 0, ofertas_activas: 0, tiendas_presencia: 0, descuento_promedio: null },
        tabla: [],
      })
    }

    // ── 3. Variantes + precios para productos enlazados ────────────
    const prodIds = [...new Set(
      catalogo
        .filter((c: any) => c.producto_id != null)
        .map((c: any) => c.producto_id as number)
    )]

    type PrecioParsed = {
      supermercado_id: number
      precio_normal:   number
      precio_oferta:   number | null
      en_oferta:       boolean
      descuento_pct:   number | null
      disponible:      boolean
    }

    const preciosPorProducto = new Map<number, PrecioParsed[]>()
    const superIdsNeeded     = new Set<number>()

    if (prodIds.length > 0) {
      const { data: varRaw } = await db
        .from('producto_variantes')
        .select('id, producto_id')
        .in('producto_id', prodIds)
        .eq('activo', true)

      const variantes  = (varRaw as any[] | null) ?? []
      const varProdMap = new Map<number, number>(variantes.map((v: any) => [v.id, v.producto_id]))
      const varIds     = variantes.map((v: any) => v.id)

      if (varIds.length > 0) {
        const { data: paRaw } = await db
          .from('precios_actuales')
          .select('variante_id, supermercado_id, precio_normal, precio_oferta, en_oferta, descuento_pct, disponible')
          .in('variante_id', varIds)

        for (const pa of (paRaw as any[] | null) ?? []) {
          const prodId = varProdMap.get(pa.variante_id)
          if (prodId === undefined) continue
          superIdsNeeded.add(pa.supermercado_id)
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
    }

    // ── 4. Supermercados ───────────────────────────────────────────
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

    // ── 5. Métricas ────────────────────────────────────────────────
    let totalOfertas           = 0
    let totalProductosConPrecio = 0
    const tiendasSet            = new Set<string>()
    let sumDescuentos           = 0
    let countDescuentos         = 0

    for (const cat of catalogo) {
      const precios = cat.producto_id != null
        ? (preciosPorProducto.get(cat.producto_id as number) ?? [])
        : []
      if (precios.length > 0) totalProductosConPrecio++
      for (const p of precios) {
        const s = superMap.get(p.supermercado_id)
        if (s?.nombre_corto) tiendasSet.add(s.nombre_corto)
        if (p.en_oferta) totalOfertas++
        if (p.descuento_pct) { sumDescuentos += p.descuento_pct; countDescuentos++ }
      }
    }

    const metricas = {
      productos_activos:    catalogo.length,
      productos_con_precio: totalProductosConPrecio,
      ofertas_activas:      totalOfertas,
      tiendas_presencia:    tiendasSet.size,
      descuento_promedio:   countDescuentos ? +(sumDescuentos / countDescuentos).toFixed(1) : null,
    }

    // ── 6. Tabla ────────────────────────────────────────────────────
    const tabla = catalogo.map((cat: any) => {
      const precios = cat.producto_id != null
        ? (preciosPorProducto.get(cat.producto_id as number) ?? [])
        : []

      let precioMinVal           = Infinity
      let precioMinSuperNombre: string | null = null
      let precioMinSuperColor:  string | null = null

      for (const p of precios) {
        const ef = p.precio_oferta ?? p.precio_normal
        if (ef < precioMinVal) {
          precioMinVal         = ef
          const s              = superMap.get(p.supermercado_id)
          precioMinSuperNombre = s?.nombre    ?? null
          precioMinSuperColor  = s?.color_hex ?? null
        }
      }

      return {
        id:                cat.id,
        producto_id:       (cat.producto_id as number | null) ?? null,
        nombre:            cat.nombre,
        marca:             (cat.marca as string | null) ?? null,
        imagen_url:        (cat.imagen_url as string | null) ?? null,
        categoria:         (cat.categoria as string | null) ?? null,
        subcategoria:      (cat.subcategoria as string | null) ?? null,
        pvp_sugerido:      cat.pvp_sugerido != null ? +cat.pvp_sugerido : null,
        enlazado:          cat.producto_id != null,
        precio_min:        precios.length > 0 ? +precioMinVal.toFixed(2) : null,
        en_oferta:         precios.some((p: PrecioParsed) => p.en_oferta),
        descuento_max:     precios.reduce((m: number, p: PrecioParsed) => Math.max(m, p.descuento_pct ?? 0), 0) || null,
        tiendas:           precios.length,
        tienda_mas_barata: precioMinSuperNombre,
        color_mas_barata:  precioMinSuperColor,
        precios_por_tienda: precios.map((p: PrecioParsed) => {
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

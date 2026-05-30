/**
 * POST /api/canasta
 * Body: { productos: [{id: number, cantidad: number}] }
 *
 * Calcula el total de la canasta en cada supermercado y devuelve
 * un ranking de tiendas por precio total (cobertura completa primero).
 * También detecta si dividir la compra entre 2 tiendas conviene.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Colores por supermercado_id (la tabla no tiene columna color)
const SUPER_COLOR: Record<number, string> = {
  1: '#DC2626', // selectos
  2: '#1D4ED8', // walmart
  3: '#16A34A', // donjuan
  4: '#EA580C', // maxidespensa
  5: '#7C3AED', // familiar
  6: '#0891B2', // pricesmart
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const productos: { id: number; cantidad: number }[] = body.productos ?? []

    if (productos.length === 0) {
      return NextResponse.json({ tiendas: [], ahorro_maximo: 0, tienda_mas_barata: null, split_sugerido: null })
    }

    const prodIds   = productos.map(p => p.id)
    const cantMap   = new Map(productos.map(p => [p.id, p.cantidad]))

    const db = createServiceClient()

    // 1. Variantes activas de los productos pedidos
    const { data: variantesRaw } = await db
      .from('producto_variantes')
      .select('id, producto_id, supermercado_id')
      .in('producto_id', prodIds)
      .eq('activo', true)

    const variantes  = (variantesRaw as any[] | null) ?? []
    const varIds     = variantes.map((v: any) => v.id as number)

    if (varIds.length === 0) {
      return NextResponse.json({ tiendas: [], ahorro_maximo: 0, tienda_mas_barata: null, split_sugerido: null })
    }

    // 2. Precios actuales + supermercados + nombres de productos (en paralelo)
    const [preciosRes, supersRes, prodsRes] = await Promise.all([
      db.from('precios_actuales')
        .select('variante_id, precio_normal, precio_oferta')
        .in('variante_id', varIds),

      db.from('supermercados')
        .select('id, nombre, nombre_corto'),

      db.from('productos')
        .select('id, nombre, imagen_url')
        .in('id', prodIds),
    ])

    const precios      = (preciosRes.data as any[] | null) ?? []
    const supermercados= (supersRes.data as any[] | null) ?? []
    const productosData= (prodsRes.data as any[] | null) ?? []

    const superMap  = new Map<number, any>(supermercados.map((s: any) => [s.id as number, s]))
    const prodMap   = new Map<number, any>(productosData.map((p: any) => [p.id as number, p]))
    const precioIdx = new Map<number, any>(precios.map((p: any) => [p.variante_id as number, p]))

    // 3. Construir: superMap<supermercado_id, Map<producto_id, mejor_precio>>
    const porTienda = new Map<number, Map<number, number>>()

    for (const v of variantes) {
      const p = precioIdx.get(v.id as number)
      if (!p) continue

      const precioEf = +(p.precio_oferta ?? p.precio_normal)
      if (!porTienda.has(v.supermercado_id)) porTienda.set(v.supermercado_id, new Map())
      const map = porTienda.get(v.supermercado_id)!
      const actual = map.get(v.producto_id as number)
      if (actual === undefined || precioEf < actual) map.set(v.producto_id as number, precioEf)
    }

    // 4. Calcular totales por tienda
    const resultados: any[] = []

    for (const [superId, prodPrecios] of porTienda) {
      const super_ = superMap.get(superId)
      if (!super_) continue

      let total        = 0
      let disponibles  = 0
      const items: any[] = []

      for (const { id: prodId, cantidad } of productos) {
        const precio = prodPrecios.get(prodId)
        const prod   = prodMap.get(prodId)
        if (precio !== undefined) {
          total += precio * cantidad
          disponibles++
          items.push({ producto_id: prodId, nombre: prod?.nombre ?? 'Producto', imagen_url: prod?.imagen_url ?? null, precio, cantidad, disponible: true })
        } else {
          items.push({ producto_id: prodId, nombre: prod?.nombre ?? 'Producto', imagen_url: prod?.imagen_url ?? null, precio: null, cantidad, disponible: false })
        }
      }

      resultados.push({
        supermercado_id:       superId,
        supermercado_nombre:   super_.nombre,
        supermercado_corto:    super_.nombre_corto ?? super_.nombre,
        color:                 SUPER_COLOR[superId] ?? '#6B7280',
        total:                 +total.toFixed(2),
        productos_disponibles: disponibles,
        productos_total:       productos.length,
        cobertura_pct:         Math.round(disponibles / productos.length * 100),
        items:                 items.sort((a: any, b: any) => a.nombre.localeCompare(b.nombre)),
      })
    }

    // Ordenar: 1) cobertura desc, 2) total asc
    resultados.sort((a, b) => {
      if (b.cobertura_pct !== a.cobertura_pct) return b.cobertura_pct - a.cobertura_pct
      return a.total - b.total
    })

    // 5. Ahorro máximo vs más cara (misma cobertura)
    const conCoberturaCompleta = resultados.filter(r => r.cobertura_pct === 100)
    const mejorTotal  = conCoberturaCompleta[0]?.total ?? resultados[0]?.total ?? 0
    const peorTotal   = conCoberturaCompleta[conCoberturaCompleta.length - 1]?.total
                      ?? resultados[resultados.length - 1]?.total ?? 0
    const ahorroMaximo = +(peorTotal - mejorTotal).toFixed(2)

    // 6. Sugerencia de split (top 2 tiendas, solo si ahorra ≥ $0.50)
    let splitSugerido = null
    if (productos.length >= 3 && resultados.length >= 2) {
      const t1 = resultados[0]
      const t2 = resultados[1]
      const mapA = porTienda.get(t1.supermercado_id)!
      const mapB = porTienda.get(t2.supermercado_id)!

      let totalSplit = 0
      let itemsA = 0, itemsB = 0

      for (const { id: prodId, cantidad } of productos) {
        const pA = mapA.get(prodId)
        const pB = mapB?.get(prodId)
        if (pA !== undefined && (pB === undefined || pA <= pB)) {
          totalSplit += pA * cantidad; itemsA++
        } else if (pB !== undefined) {
          totalSplit += pB * cantidad; itemsB++
        }
      }

      const ahorroSplit = +(t1.total - totalSplit).toFixed(2)
      if (ahorroSplit >= 0.50 && itemsB > 0) {
        splitSugerido = {
          tienda_1:       t1.supermercado_nombre,
          tienda_2:       t2.supermercado_nombre,
          color_1:        t1.color,
          color_2:        t2.color,
          total:          +totalSplit.toFixed(2),
          ahorro:         ahorroSplit,
          items_tienda_1: itemsA,
          items_tienda_2: itemsB,
        }
      }
    }

    return NextResponse.json({
      tiendas:          resultados,
      ahorro_maximo:    ahorroMaximo,
      tienda_mas_barata:resultados[0]?.supermercado_nombre ?? null,
      split_sugerido:   splitSugerido,
    })
  } catch (err) {
    console.error('[canasta]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

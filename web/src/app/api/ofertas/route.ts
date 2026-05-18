import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { OfertaDelDia } from '@/types/database'

export const revalidate = 1800 // revalida cada 30 minutos (post-scrape)

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const supermercado = searchParams.get('supermercado')
  const limit = Math.min(Number(searchParams.get('limit') ?? 24), 100)

  try {
    const supabase = await createClient()

    // NOTE: precios_actuales es una vista materializada — PostgREST no infiere FKs.
    // Los joins se resuelven manualmente en dos pasos.

    // ── Paso 1: Precios con oferta activa ─────────────────────
    let preciosQuery = supabase
      .from('precios_actuales')
      .select('producto_id, supermercado_id, precio_normal, precio_oferta, descuento_pct, condicion_oferta')
      .eq('en_oferta', true)
      .not('precio_oferta', 'is', null)
      .not('descuento_pct', 'is', null)
      .order('descuento_pct', { ascending: false })
      .limit(limit)

    const { data: precRaw, error: ePrec } = await preciosQuery
    if (ePrec) {
      console.error('[ofertas] error supabase:', ePrec)
      return NextResponse.json({ error: 'Error interno' }, { status: 500 })
    }
    const precios = (precRaw as any[] | null) ?? []
    if (!precios.length) return NextResponse.json({ ofertas: [], total: 0 })

    // ── Paso 2: Resolver productos y supermercados ────────────
    const prodIds   = [...new Set(precios.map((p: any) => p.producto_id as number))]
    const superIds  = [...new Set(precios.map((p: any) => p.supermercado_id as number))]

    const [{ data: prodsRaw }, { data: supersRaw }] = await Promise.all([
      supabase.from('productos')
        .select('id, nombre_normalizado, marca, imagen_url')
        .in('id', prodIds)
        .eq('activo', true),
      supabase.from('supermercados')
        .select('id, nombre, nombre_corto, color_hex')
        .in('id', superIds),
    ])

    const prodsMap  = new Map<number, any>(((prodsRaw as any[] | null) ?? []).map((p: any) => [p.id, p]))
    const supersMap = new Map<number, any>(((supersRaw as any[] | null) ?? []).map((s: any) => [s.id, s]))

    // Filtrar por supermercado si se pidió
    const preciosFiltrados = supermercado && supermercado !== 'todos'
      ? precios.filter((p: any) => supersMap.get(p.supermercado_id)?.nombre_corto === supermercado)
      : precios

    const ofertas: OfertaDelDia[] = preciosFiltrados
      .filter((p: any) => prodsMap.has(p.producto_id) && supersMap.has(p.supermercado_id))
      .map((p: any) => {
        const prod  = prodsMap.get(p.producto_id)
        const super_ = supersMap.get(p.supermercado_id)
        return {
          producto_id:         p.producto_id,
          nombre_normalizado:  prod.nombre_normalizado,
          marca:               prod.marca,
          imagen_url:          prod.imagen_url,
          precio_normal:       p.precio_normal,
          precio_oferta:       p.precio_oferta,
          descuento_pct:       p.descuento_pct,
          condicion_oferta:    p.condicion_oferta,
          supermercado_id:     p.supermercado_id,
          supermercado_nombre: super_.nombre,
          supermercado_key:    super_.nombre_corto,
          supermercado_color:  super_.color_hex,
          categoria_nombre:    null,
        }
      })

    return NextResponse.json({ ofertas, total: ofertas.length })
  } catch (err) {
    console.error('[ofertas] error inesperado:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

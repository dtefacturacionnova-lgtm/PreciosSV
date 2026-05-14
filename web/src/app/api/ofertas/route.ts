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

    // Consulta a la vista materializada precios_actuales
    // joinea con productos, variantes y supermercados
    let query = supabase
      .from('precios_actuales')
      .select(`
        producto_id,
        precio_normal,
        precio_oferta,
        descuento_pct,
        condicion_oferta,
        supermercado_id,
        productos!inner (
          nombre_normalizado,
          marca,
          imagen_url,
          activo
        ),
        producto_variantes!inner (
          supermercado_id,
          activo
        ),
        supermercados!inner (
          nombre,
          nombre_corto,
          color_hex
        )
      `)
      .eq('en_oferta', true)
      .eq('productos.activo', true)
      .eq('producto_variantes.activo', true)
      .not('precio_oferta', 'is', null)
      .not('descuento_pct', 'is', null)
      .order('descuento_pct', { ascending: false })
      .limit(limit)

    if (supermercado && supermercado !== 'todos') {
      query = query.eq('supermercados.nombre_corto', supermercado)
    }

    const { data: rawData, error } = await query
    const data = rawData as any[] | null

    if (error) {
      console.error('[ofertas] error supabase:', error)
      return NextResponse.json({ error: 'Error interno' }, { status: 500 })
    }

    const ofertas: OfertaDelDia[] = (data ?? []).map((row: any) => ({
      producto_id:          row.producto_id,
      nombre_normalizado:   row.productos.nombre_normalizado,
      marca:                row.productos.marca,
      imagen_url:           row.productos.imagen_url,
      precio_normal:        row.precio_normal,
      precio_oferta:        row.precio_oferta,
      descuento_pct:        row.descuento_pct,
      condicion_oferta:     row.condicion_oferta,
      supermercado_id:      row.supermercado_id,
      supermercado_nombre:  row.supermercados.nombre,
      supermercado_key:     row.supermercados.nombre_corto,
      supermercado_color:   row.supermercados.color_hex,
      categoria_nombre:     null,
    }))

    return NextResponse.json({ ofertas, total: ofertas.length })
  } catch (err) {
    console.error('[ofertas] error inesperado:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

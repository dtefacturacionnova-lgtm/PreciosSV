import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const revalidate = 1800

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const productoId = parseInt(id)
  if (isNaN(productoId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const { searchParams } = new URL(req.url)
  const dias = Math.min(parseInt(searchParams.get('dias') ?? '30'), 90)
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()

  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('precios')
      .select(`
        precio_normal, precio_oferta, en_oferta, fecha_hora,
        producto_variantes!inner(
          producto_id,
          supermercados!inner(nombre, nombre_corto, color_hex)
        )
      `)
      .eq('producto_variantes.producto_id', productoId)
      .gte('fecha_hora', desde)
      .order('fecha_hora', { ascending: true })

    if (error) throw error

    const historico = (data ?? []).map((row: any) => ({
      fecha:               row.fecha_hora,
      precio_efectivo:     row.precio_oferta ?? row.precio_normal,
      precio_normal:       row.precio_normal,
      precio_oferta:       row.precio_oferta,
      en_oferta:           row.en_oferta,
      supermercado_nombre: row.producto_variantes.supermercados.nombre,
      supermercado_key:    row.producto_variantes.supermercados.nombre_corto,
      supermercado_color:  row.producto_variantes.supermercados.color_hex,
    }))

    return NextResponse.json({ historico, dias })
  } catch (err) {
    console.error('[historico]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

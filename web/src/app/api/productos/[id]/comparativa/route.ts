import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const revalidate = 1800

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const productoId = parseInt(id)
  if (isNaN(productoId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  try {
    const supabase = await createClient()

    // Producto base
    const { data: producto, error: eProd } = await supabase
      .from('productos')
      .select('id, nombre_normalizado, marca, imagen_url, ean, unidad, cantidad, categorias(nombre, slug)')
      .eq('id', productoId)
      .eq('activo', true)
      .single()

    if (eProd || !producto) return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 })

    // Precios actuales en todos los supermercados
    const { data: precios, error: ePrecios } = await supabase
      .from('precios_actuales')
      .select(`
        precio_normal, precio_oferta, en_oferta, descuento_pct,
        disponible, condicion_oferta, fecha_hora,
        producto_variantes!inner(url_producto, activo),
        supermercados!inner(id, nombre, nombre_corto, color_hex, sitio_web)
      `)
      .eq('producto_id', productoId)
      .eq('producto_variantes.activo', true)
      .order('precio_oferta', { ascending: true, nullsFirst: false })

    if (ePrecios) throw ePrecios

    // Ordenar: con oferta primero, luego por precio efectivo
    const preciosOrdenados = (precios ?? [])
      .map((p: any) => ({
        supermercado_id:     p.supermercados.id,
        supermercado_nombre: p.supermercados.nombre,
        supermercado_key:    p.supermercados.nombre_corto,
        supermercado_color:  p.supermercados.color_hex,
        url_producto:        p.producto_variantes.url_producto,
        precio_normal:       p.precio_normal,
        precio_oferta:       p.precio_oferta,
        precio_efectivo:     p.precio_oferta ?? p.precio_normal,
        en_oferta:           p.en_oferta,
        descuento_pct:       p.descuento_pct,
        disponible:          p.disponible,
        condicion_oferta:    p.condicion_oferta,
        fecha_hora:          p.fecha_hora,
      }))
      .sort((a: any, b: any) => a.precio_efectivo - b.precio_efectivo)

    return NextResponse.json({ producto, precios: preciosOrdenados })
  } catch (err) {
    console.error('[comparativa]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

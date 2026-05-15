import { createServiceClient } from '@/lib/supabase/service'
import { getProveedorAutenticadoODev } from '@/lib/supabase/auth-proveedor'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/proveedores/catalogo/[id]/precios
 *
 * Retorna los precios actuales del producto en cada supermercado.
 * Requiere que el producto tenga producto_id enlazado vía EAN.
 * Llama a la función Postgres fn_precios_por_producto(producto_id).
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const proveedor = await getProveedorAutenticadoODev()
    if (!proveedor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { id } = await context.params
    const catalogoId = Number(id)
    if (isNaN(catalogoId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const db = createServiceClient()

    // Verificar propiedad y obtener producto_id enlazado
    const { data: catalogoRaw, error: catalogoErr } = await (db as any)
      .from('proveedor_catalogo')
      .select('id, producto_id, nombre')
      .eq('id', catalogoId)
      .eq('proveedor_id', proveedor.id)
      .eq('activo', true)
      .single()

    if (catalogoErr || !catalogoRaw) {
      return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 })
    }

    const catalogo = catalogoRaw as any

    // Sin enlace EAN → devolver estado sin datos
    if (!catalogo.producto_id) {
      return NextResponse.json({
        enlazado: false,
        producto_id: null,
        precios: [],
        mensaje: 'Este producto no tiene EAN registrado o no hay coincidencia en la base de precios todavía.',
      })
    }

    // Llamar a la función Postgres que retorna precios por supermercado
    const { data: precios, error: preciosErr } = await (db as any)
      .rpc('fn_precios_por_producto', { p_producto_id: catalogo.producto_id })

    // Si la función RPC no existe todavía (migración pendiente), devolver estado vacío
    if (preciosErr) {
      const isPendingMigration =
        preciosErr.code === 'PGRST202' ||          // function not found
        preciosErr.message?.includes('does not exist') ||
        preciosErr.message?.includes('no existe')
      if (isPendingMigration) {
        return NextResponse.json({
          enlazado: true,
          producto_id: catalogo.producto_id,
          nombre: catalogo.nombre,
          precios: [],
          mensaje: 'Los precios aparecerán aquí después del primer ciclo de scraping.',
        })
      }
      return NextResponse.json({ error: preciosErr.message }, { status: 500 })
    }

    return NextResponse.json({
      enlazado: true,
      producto_id: catalogo.producto_id,
      nombre: catalogo.nombre,
      precios: (precios as any[] | null) ?? [],
    })
  } catch (err) {
    console.error('[catalogo/[id]/precios GET]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

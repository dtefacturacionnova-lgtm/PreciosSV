import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

async function getProveedor() {
  const db = createServiceClient()
  const { data: pRaw } = await db.from('proveedores').select('id,marcas,competidores').limit(1).single()
  const p = pRaw as any
  return p ?? null
}

// PATCH — update product fields
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const proveedor = await getProveedor()
    if (!proveedor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { id } = await context.params
    const productoId = Number(id)
    if (isNaN(productoId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const body = await req.json()
    const db = createServiceClient()

    const { data: existingRaw } = await (db as any)
      .from('proveedor_catalogo')
      .select('id, proveedor_id')
      .eq('id', productoId)
      .eq('proveedor_id', proveedor.id)
      .single()

    if (!existingRaw) return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 })

    const allowed = [
      'nombre', 'marca', 'presentacion', 'gramaje', 'unidad',
      'ean_13', 'upc_12', 'codigo_interno', 'imagen_url',
      'pvp_sugerido', 'notas', 'categoria_id', 'activo',
    ]
    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    for (const key of allowed) {
      if (key in body) updates[key] = body[key]
    }

    const { data: updatedRaw, error } = await (db as any)
      .from('proveedor_catalogo')
      .update(updates)
      .eq('id', productoId)
      .eq('proveedor_id', proveedor.id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: (error as any).message }, { status: 500 })

    return NextResponse.json({ producto: updatedRaw as any })
  } catch (err) {
    console.error('[proveedores/catalogo/[id] PATCH]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// DELETE — soft delete (set activo=false)
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const proveedor = await getProveedor()
    if (!proveedor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { id } = await context.params
    const productoId = Number(id)
    if (isNaN(productoId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const db = createServiceClient()

    const { error } = await (db as any)
      .from('proveedor_catalogo')
      .update({ activo: false, updated_at: new Date().toISOString() })
      .eq('id', productoId)
      .eq('proveedor_id', proveedor.id)

    if (error) return NextResponse.json({ error: (error as any).message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[proveedores/catalogo/[id] DELETE]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

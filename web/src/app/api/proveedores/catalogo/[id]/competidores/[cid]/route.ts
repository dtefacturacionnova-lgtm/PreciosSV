import { createServiceClient } from '@/lib/supabase/service'
import { getProveedorAutenticadoODev } from '@/lib/supabase/auth-proveedor'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

async function verifyOwnership(db: any, competidorId: number, productoId: number, proveedorId: number) {
  const { data } = await (db as any)
    .from('proveedor_competidores_catalogo')
    .select('id, proveedor_catalogo!inner(id, proveedor_id)')
    .eq('id', competidorId)
    .eq('producto_id', productoId)
    .eq('proveedor_catalogo.proveedor_id', proveedorId)
    .single()
  return data ?? null
}

// DELETE — soft delete competitor (set activo=false)
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string; cid: string }> }
) {
  try {
    const proveedor = await getProveedorAutenticadoODev()
    if (!proveedor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { id, cid } = await context.params
    const productoId   = Number(id)
    const competidorId = Number(cid)
    if (isNaN(productoId) || isNaN(competidorId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const db = createServiceClient()
    const competidor = await verifyOwnership(db, competidorId, productoId, proveedor.id)
    if (!competidor) return NextResponse.json({ error: 'Competidor no encontrado' }, { status: 404 })

    const { error } = await (db as any)
      .from('proveedor_competidores_catalogo')
      .update({ activo: false })
      .eq('id', competidorId)
      .eq('producto_id', productoId)

    if (error) return NextResponse.json({ error: (error as any).message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[catalogo/[id]/competidores/[cid] DELETE]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// PATCH — update competitor fields
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; cid: string }> }
) {
  try {
    const proveedor = await getProveedorAutenticadoODev()
    if (!proveedor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { id, cid } = await context.params
    const productoId   = Number(id)
    const competidorId = Number(cid)
    if (isNaN(productoId) || isNaN(competidorId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const db = createServiceClient()
    const competidor = await verifyOwnership(db, competidorId, productoId, proveedor.id)
    if (!competidor) return NextResponse.json({ error: 'Competidor no encontrado' }, { status: 404 })

    const body = await req.json()

    if (body.tipo_relacion) {
      const tiposValidos = ['SUSTITUTO_DIRECTO', 'ALTERNATIVA_PREMIUM', 'ALTERNATIVA_ECONOMICA']
      if (!tiposValidos.includes(body.tipo_relacion)) {
        return NextResponse.json({ error: `tipo_relacion debe ser uno de: ${tiposValidos.join(', ')}` }, { status: 400 })
      }
    }

    const allowed = [
      'competidor_ean_13', 'competidor_upc_12',
      'competidor_nombre', 'competidor_marca',
      'competidor_producto_id',       // vínculo manual a producto scrapeado
      'tipo_relacion', 'factor_conversion',
      'misma_presentacion', 'prioridad', 'notas', 'activo',
    ]
    const updates: Record<string, any> = {}
    for (const key of allowed) {
      if (key in body) updates[key] = body[key]
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No hay campos para actualizar' }, { status: 400 })
    }

    const { data: updatedRaw, error } = await (db as any)
      .from('proveedor_competidores_catalogo')
      .update(updates)
      .eq('id', competidorId)
      .eq('producto_id', productoId)
      .select()
      .single()

    if (error) return NextResponse.json({ error: (error as any).message }, { status: 500 })

    return NextResponse.json({ competidor: updatedRaw as any })
  } catch (err) {
    console.error('[catalogo/[id]/competidores/[cid] PATCH]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

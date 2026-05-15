import { createServiceClient } from '@/lib/supabase/service'
import { getProveedorAutenticadoODev } from '@/lib/supabase/auth-proveedor'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

async function verifyProductoOwnership(db: any, productoId: number, proveedorId: number) {
  const { data } = await (db as any)
    .from('proveedor_catalogo')
    .select('id')
    .eq('id', productoId)
    .eq('proveedor_id', proveedorId)
    .eq('activo', true)
    .single()
  return data ?? null
}

// GET — returns all competitors for a product
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const proveedor = await getProveedorAutenticadoODev()
    if (!proveedor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { id } = await context.params
    const productoId = Number(id)
    if (isNaN(productoId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const db = createServiceClient()
    const producto = await verifyProductoOwnership(db, productoId, proveedor.id)
    if (!producto) return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 })

    const { data: raw, error } = await (db as any)
      .from('proveedor_competidores_catalogo')
      .select(`
        id, producto_id,
        competidor_ean_13, competidor_upc_12,
        competidor_nombre, competidor_marca,
        competidor_producto_id,
        tipo_relacion, factor_conversion,
        misma_presentacion, prioridad,
        notas, activo, created_at
      `)
      .eq('producto_id', productoId)
      .eq('activo', true)
      .order('prioridad')
      .order('competidor_nombre')

    if (error) return NextResponse.json({ error: (error as any).message }, { status: 500 })

    return NextResponse.json((raw as any[] | null) ?? [])
  } catch (err) {
    console.error('[catalogo/[id]/competidores GET]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// POST — adds a competitor to a product
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const proveedor = await getProveedorAutenticadoODev()
    if (!proveedor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { id } = await context.params
    const productoId = Number(id)
    if (isNaN(productoId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const db = createServiceClient()
    const producto = await verifyProductoOwnership(db, productoId, proveedor.id)
    if (!producto) return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 })

    const body = await req.json()
    const {
      competidor_ean_13, competidor_upc_12,
      competidor_nombre, competidor_marca,
      tipo_relacion, factor_conversion,
      misma_presentacion, prioridad, notas,
    } = body

    if (!competidor_nombre || !competidor_marca || !tipo_relacion) {
      return NextResponse.json({ error: 'competidor_nombre, competidor_marca y tipo_relacion son requeridos' }, { status: 400 })
    }

    const tiposValidos = ['SUSTITUTO_DIRECTO', 'ALTERNATIVA_PREMIUM', 'ALTERNATIVA_ECONOMICA']
    if (!tiposValidos.includes(tipo_relacion)) {
      return NextResponse.json({ error: `tipo_relacion debe ser uno de: ${tiposValidos.join(', ')}` }, { status: 400 })
    }

    const { data: newRaw, error } = await (db as any)
      .from('proveedor_competidores_catalogo')
      .insert({
        producto_id:        productoId,
        competidor_ean_13:  competidor_ean_13 ?? null,
        competidor_upc_12:  competidor_upc_12 ?? null,
        competidor_nombre,
        competidor_marca,
        tipo_relacion,
        factor_conversion:  factor_conversion ?? 1.0,
        misma_presentacion: misma_presentacion ?? true,
        prioridad:          prioridad ?? 2,
        notas:              notas ?? null,
        activo:             true,
        created_at:         new Date().toISOString(),
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: (error as any).message }, { status: 500 })

    return NextResponse.json({ competidor: newRaw as any }, { status: 201 })
  } catch (err) {
    console.error('[catalogo/[id]/competidores POST]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

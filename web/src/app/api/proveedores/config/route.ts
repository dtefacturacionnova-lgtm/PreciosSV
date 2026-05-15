/**
 * GET  /api/proveedores/config  → { competidores: string[] }
 * PATCH /api/proveedores/config  body: { competidores: string[] }
 */
import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

async function getProveedor() {
  const db = createServiceClient()
  const { data: pRaw } = await db.from('proveedores').select('id,marcas,competidores').limit(1).single()
  const p = pRaw as any
  return p ?? null
}

// GET — devuelve configuración actual del proveedor
export async function GET() {
  const proveedor = await getProveedor()
  if (!proveedor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  return NextResponse.json({
    competidores: proveedor.competidores ?? [],
  })
}

// PATCH — actualiza lista de marcas competidoras
export async function PATCH(req: NextRequest) {
  const proveedor = await getProveedor()
  if (!proveedor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await req.json()
  const db = createServiceClient()

  if (Array.isArray(body.competidores)) {
    const { error } = await (db as any)
      .from('proveedores')
      .update({ competidores: body.competidores })
      .eq('id', proveedor.id)
    if (error) return NextResponse.json({ error: (error as any).message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

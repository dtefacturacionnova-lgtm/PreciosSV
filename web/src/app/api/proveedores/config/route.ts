/**
 * PATCH /api/proveedores/config
 * Actualiza: competidores[], precio_sugerido por producto
 */
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

async function getProveedor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const db = createServiceClient()
  const { data: uRaw } = await db.from('usuarios').select('id,rol').eq('auth_id', user.id).single()
  const u = uRaw as any
  if (!u || (u.rol !== 'proveedor' && u.rol !== 'admin')) return null

  const { data: pRaw } = await db.from('proveedores').select('id,marcas,competidores').eq('usuario_id', u.id).single()
  const p = pRaw as any
  return p ? { ...p, usuario: u } : null
}

// GET — devuelve config actual (competidores + precios referencia)
export async function GET() {
  const proveedor = await getProveedor()
  if (!proveedor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const db = createServiceClient()
  const { data: refs } = await db
    .from('proveedor_precios_referencia')
    .select('producto_id, precio_sugerido, precio_promo, en_promocion, notas')
    .eq('proveedor_id', proveedor.id)

  return NextResponse.json({
    competidores: proveedor.competidores ?? [],
    referencias: (refs as any[] | null) ?? [],
  })
}

// PATCH — actualiza competidores o precios de referencia
export async function PATCH(req: NextRequest) {
  const proveedor = await getProveedor()
  if (!proveedor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await req.json()
  const db = createServiceClient()

  // Actualizar competidores
  if (Array.isArray(body.competidores)) {
    const { error } = await (db as any)
      .from('proveedores')
      .update({ competidores: body.competidores })
      .eq('id', proveedor.id)
    if (error) return NextResponse.json({ error: (error as any).message }, { status: 500 })
  }

  // Upsert precio de referencia para un producto
  if (body.referencia) {
    const { producto_id, precio_sugerido, precio_promo, en_promocion, notas } = body.referencia
    const { error } = await (db as any)
      .from('proveedor_precios_referencia')
      .upsert({
        proveedor_id: proveedor.id,
        producto_id,
        precio_sugerido: precio_sugerido ?? null,
        precio_promo: precio_promo ?? null,
        en_promocion: en_promocion ?? false,
        notas: notas ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'proveedor_id,producto_id' })
    if (error) return NextResponse.json({ error: (error as any).message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

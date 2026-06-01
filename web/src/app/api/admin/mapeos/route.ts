/**
 * GET  /api/admin/mapeos          — lista sugerencias pendientes de validar
 * POST /api/admin/mapeos          — crear mapeo manual
 * PATCH /api/admin/mapeos?id=X   — aprobar (validado=true) o rechazar (rechazado=true)
 */
import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const solo = searchParams.get('solo') // 'pendientes' | 'validados' | 'todos'
  const db = createServiceClient()

  let query = (db as any)
    .from('mapeo_selectos')
    .select(`
      id, selectos_sku, confianza, metodo, validado, rechazado,
      validado_at, notas, created_at,
      productos!inner(id, nombre, nombre_normalizado, ean, imagen_url, marca)
    `)
    .order('confianza', { ascending: false })
    .limit(100)

  if (solo === 'pendientes') {
    query = query.eq('validado', false).eq('rechazado', false)
  } else if (solo === 'validados') {
    query = query.eq('validado', true)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ mapeos: data ?? [] })
}

export async function POST(req: NextRequest) {
  const { selectos_sku, producto_id, notas } = await req.json()
  if (!selectos_sku || !producto_id) {
    return NextResponse.json({ error: 'selectos_sku y producto_id requeridos' }, { status: 400 })
  }
  const db = createServiceClient()
  const { data, error } = await (db as any)
    .from('mapeo_selectos')
    .upsert({
      selectos_sku: String(selectos_sku),
      producto_id:  Number(producto_id),
      metodo:       'manual',
      confianza:    1.0,
      validado:     true,
      validado_at:  new Date().toISOString(),
      notas:        notas ?? 'Validado manualmente',
    }, { onConflict: 'selectos_sku' })
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, mapeo: data?.[0] })
}

export async function PATCH(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  const { accion } = await req.json() // 'aprobar' | 'rechazar'
  const db = createServiceClient()

  const update = accion === 'aprobar'
    ? { validado: true, rechazado: false, validado_at: new Date().toISOString() }
    : { validado: false, rechazado: true }

  const { error } = await (db as any)
    .from('mapeo_selectos')
    .update(update)
    .eq('id', Number(id))

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/**
 * POST /api/alertas
 * Crea una alerta de precio para un producto.
 * Guarda en la tabla alertas_usuario con email + precio objetivo.
 *
 * Body: { producto_id, precio_objetivo, email }
 */
import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { producto_id, precio_objetivo, email } = body

    // Validaciones
    if (!producto_id || typeof producto_id !== 'number') {
      return NextResponse.json({ error: 'producto_id requerido' }, { status: 400 })
    }
    if (!precio_objetivo || typeof precio_objetivo !== 'number' || precio_objetivo <= 0) {
      return NextResponse.json({ error: 'precio_objetivo inválido' }, { status: 400 })
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'email inválido' }, { status: 400 })
    }

    const db = createServiceClient()

    // Verificar que el producto existe
    const { data: prod, error: eProd } = await db
      .from('productos')
      .select('id, nombre_normalizado')
      .eq('id', producto_id)
      .eq('activo', true)
      .maybeSingle()

    if (eProd || !prod) {
      return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 })
    }

    // Verificar si ya existe una alerta activa para mismo email+producto
    const { data: existing } = await (db as any)
      .from('alertas_usuario')
      .select('id')
      .eq('producto_id', producto_id)
      .eq('email', email.toLowerCase().trim())
      .eq('activa', true)
      .maybeSingle()

    if (existing) {
      // Actualizar precio objetivo
      await (db as any)
        .from('alertas_usuario')
        .update({ precio_objetivo, updated_at: new Date().toISOString() })
        .eq('id', (existing as any).id)

      return NextResponse.json({
        ok: true,
        mensaje: `Alerta actualizada — te avisaremos cuando ${(prod as any).nombre_normalizado} baje de $${precio_objetivo.toFixed(2)}`,
        modo: 'actualizada',
      })
    }

    // Insertar nueva alerta
    const { error: eIns } = await (db as any)
      .from('alertas_usuario')
      .insert({
        producto_id,
        email:           email.toLowerCase().trim(),
        precio_objetivo,
        activa:          true,
        created_at:      new Date().toISOString(),
      })

    if (eIns) {
      console.error('[alertas] error insertar:', eIns)
      return NextResponse.json({ error: 'Error al guardar la alerta' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      mensaje: `Alerta creada — te avisaremos cuando ${(prod as any).nombre_normalizado} baje de $${precio_objetivo.toFixed(2)}`,
      modo: 'creada',
    })
  } catch (err) {
    console.error('[alertas]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// GET — listar alertas de un email (para verificar)
export async function GET(req: NextRequest) {
  const email = new URL(req.url).searchParams.get('email')
  if (!email) return NextResponse.json({ alertas: [] })

  const db = createServiceClient()
  const { data } = await (db as any)
    .from('alertas_usuario')
    .select('id, producto_id, precio_objetivo, activa, created_at, productos(nombre_normalizado)')
    .eq('email', email.toLowerCase().trim())
    .eq('activa', true)
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ alertas: (data as any[] | null) ?? [] })
}

/**
 * GET /api/proveedores/buscar-producto?q=texto&limit=15
 * Busca productos scrapeados en la tabla `productos` por nombre o marca.
 * Usado para vincular manualmente un item del catálogo propio o un competidor
 * a un producto ya existente en el sistema de scraping.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const q     = (searchParams.get('q') ?? '').trim()
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '15'), 30)

    if (q.length < 2) {
      return NextResponse.json({ productos: [] })
    }

    const db = createServiceClient()

    // Busca por nombre normalizado O por marca (case-insensitive)
    const { data: raw, error } = await db
      .from('productos')
      .select('id, nombre_normalizado, marca, imagen_url, ean_13')
      .or(`nombre_normalizado.ilike.%${q}%,marca.ilike.%${q}%`)
      .eq('activo', true)
      .order('nombre_normalizado')
      .limit(limit)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const productos = ((raw as any[] | null) ?? []).map((p: any) => ({
      id:         p.id,
      nombre:     p.nombre_normalizado,
      marca:      p.marca,
      imagen_url: p.imagen_url ?? null,
      ean_13:     p.ean_13    ?? null,
    }))

    return NextResponse.json({ productos })
  } catch (err) {
    console.error('[proveedores/buscar-producto]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

async function getProveedor() {
  const db = createServiceClient()
  const { data: pRaw } = await db.from('proveedores').select('id,marcas,competidores').limit(1).single()
  const p = pRaw as any
  return p ?? null
}

// GET — returns all products for the proveedor with competitor count per product
export async function GET() {
  try {
    const proveedor = await getProveedor()
    if (!proveedor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const db = createServiceClient()

    const { data: productosRaw, error } = await (db as any)
      .from('proveedor_catalogo')
      .select(`
        id, nombre, marca, presentacion, gramaje, unidad,
        ean_13, upc_12, codigo_interno, imagen_url,
        pvp_sugerido, notas, activo, created_at, updated_at,
        categoria_id,
        categorias(nombre),
        proveedor_competidores_catalogo(count)
      `)
      .eq('proveedor_id', proveedor.id)
      .eq('activo', true)
      .order('nombre')

    if (error) return NextResponse.json({ error: (error as any).message }, { status: 500 })

    const productos = ((productosRaw as any[] | null) ?? []).map((p: any) => ({
      id:              p.id,
      nombre:          p.nombre,
      marca:           p.marca,
      presentacion:    p.presentacion,
      gramaje:         p.gramaje,
      unidad:          p.unidad,
      ean_13:          p.ean_13,
      upc_12:          p.upc_12,
      codigo_interno:  p.codigo_interno,
      imagen_url:      p.imagen_url,
      pvp_sugerido:    p.pvp_sugerido,
      notas:           p.notas,
      activo:          p.activo,
      created_at:      p.created_at,
      updated_at:      p.updated_at,
      categoria_id:    p.categoria_id,
      categoria:       (p.categorias as any)?.nombre ?? null,
      competidores_count: Array.isArray(p.proveedor_competidores_catalogo)
        ? p.proveedor_competidores_catalogo.filter((c: any) => c.activo !== false).length
        : ((p.proveedor_competidores_catalogo as any)?.[0]?.count ?? 0),
    }))

    return NextResponse.json({ productos })
  } catch (err) {
    console.error('[proveedores/catalogo GET]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// POST — creates a new product
export async function POST(req: NextRequest) {
  try {
    const proveedor = await getProveedor()
    if (!proveedor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const body = await req.json()
    const {
      nombre, marca, presentacion,
      gramaje, unidad, ean_13, upc_12,
      codigo_interno, pvp_sugerido, notas, categoria_id,
    } = body

    if (!nombre || !marca || !presentacion) {
      return NextResponse.json({ error: 'nombre, marca y presentacion son requeridos' }, { status: 400 })
    }

    const db = createServiceClient()
    const now = new Date().toISOString()

    const { data: newRaw, error } = await (db as any)
      .from('proveedor_catalogo')
      .insert({
        proveedor_id:   proveedor.id,
        nombre,
        marca,
        presentacion,
        gramaje:        gramaje ?? null,
        unidad:         unidad ?? null,
        ean_13:         ean_13 ?? null,
        upc_12:         upc_12 ?? null,
        codigo_interno: codigo_interno ?? null,
        pvp_sugerido:   pvp_sugerido ?? null,
        notas:          notas ?? null,
        categoria_id:   categoria_id ?? null,
        activo:         true,
        created_at:     now,
        updated_at:     now,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: (error as any).message }, { status: 500 })

    return NextResponse.json({ producto: newRaw as any }, { status: 201 })
  } catch (err) {
    console.error('[proveedores/catalogo POST]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

/**
 * GET /api/proveedores/simulador
 *   Sin params → devuelve { catalogo_lista } para poblar el selector.
 *
 * GET /api/proveedores/simulador?catalog_id=X
 *   → devuelve { catalogo_item, competidores, catalogo_lista }
 *   para alimentar el simulador de guerra de precios.
 *
 * Nota: precios_actuales es una vista materializada; PostgREST no infiere
 * FKs desde ella, así que todos los joins se resuelven manualmente.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { getProveedorAutenticadoODev } from '@/lib/supabase/auth-proveedor'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const prov = await getProveedorAutenticadoODev()
    if (!prov) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const db = createServiceClient()

    // ── Catálogo del proveedor (siempre se devuelve) ───────────────
    const { data: catalogoRaw } = await (db as any)
      .from('proveedor_catalogo')
      .select('id, nombre, pvp_sugerido')
      .eq('proveedor_id', prov.id)
      .eq('activo', true)
      .order('nombre')

    const catalogoLista = (catalogoRaw as any[] | null) ?? []

    const { searchParams } = new URL(req.url)
    const catalogId = searchParams.get('catalog_id')

    if (!catalogId) {
      return NextResponse.json({ catalogo_lista: catalogoLista })
    }

    // ── Item específico del catálogo ───────────────────────────────
    const { data: catRaw } = await (db as any)
      .from('proveedor_catalogo')
      .select('id, nombre, imagen_url, pvp_sugerido, producto_id')
      .eq('id', catalogId)
      .eq('proveedor_id', prov.id)
      .single()

    if (!catRaw) {
      return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 })
    }
    const cat = catRaw as any

    // ── Competidores enlazados ─────────────────────────────────────
    const { data: compLinksRaw } = await (db as any)
      .from('proveedor_competidores_catalogo')
      .select('competidor_producto_id')
      .eq('producto_id', cat.id)
      .eq('activo', true)
      .not('competidor_producto_id', 'is', null)

    const compProdIds: number[] = (
      (compLinksRaw as any[] | null) ?? []
    ).map((l: any) => l.competidor_producto_id as number)

    // ── Precio propio actual (promedio de variantes propias) ───────
    let precio_propio_actual: number | null = null

    if (cat.producto_id) {
      const { data: propVarRaw } = await db
        .from('producto_variantes')
        .select('id')
        .eq('producto_id', cat.producto_id)
        .eq('activo', true)
        .limit(10)

      const propVarIds = ((propVarRaw as any[] | null) ?? []).map((v: any) => v.id as number)

      if (propVarIds.length > 0) {
        const { data: propPreciosRaw } = await db
          .from('precios_actuales')
          .select('precio_normal, precio_oferta')
          .in('variante_id', propVarIds)

        const lista = ((propPreciosRaw as any[] | null) ?? [])
          .map((p: any) => +(p.precio_oferta ?? p.precio_normal))

        if (lista.length > 0) {
          precio_propio_actual = +(lista.reduce((s, n) => s + n, 0) / lista.length).toFixed(2)
        }
      }
    }

    // ── Precios de competidores ────────────────────────────────────
    type Competidor = {
      nombre:       string
      supermercado: string
      precio:       number
      en_oferta:    boolean
    }
    const competidores: Competidor[] = []

    if (compProdIds.length > 0) {
      const { data: varRaw } = await db
        .from('producto_variantes')
        .select('id, producto_id, supermercado_id')
        .in('producto_id', compProdIds)
        .eq('activo', true)

      const variantes = (varRaw as any[] | null) ?? []
      const varIds    = variantes.map((v: any) => v.id as number)

      if (varIds.length > 0) {
        const [preciosRaw, supersRaw, prodsRaw] = await Promise.all([
          db.from('precios_actuales')
            .select('variante_id, precio_normal, precio_oferta')
            .in('variante_id', varIds),
          db.from('supermercados').select('id, nombre'),
          db.from('productos').select('id, nombre').in('id', compProdIds),
        ])

        const supersMap = new Map<number, string>(
          ((supersRaw.data as any[] | null) ?? []).map((s: any) => [s.id as number, s.nombre as string])
        )
        const prodsMap = new Map<number, string>(
          ((prodsRaw.data as any[] | null) ?? []).map((p: any) => [p.id as number, p.nombre as string])
        )
        const varMap = new Map<number, any>(
          variantes.map((v: any) => [v.id as number, v])
        )

        for (const p of (preciosRaw.data as any[] | null) ?? []) {
          const v = varMap.get(p.variante_id as number)
          if (!v) continue
          competidores.push({
            nombre:       prodsMap.get(v.producto_id as number) ?? 'Competidor',
            supermercado: supersMap.get(v.supermercado_id as number) ?? 'Desconocido',
            precio:       +(p.precio_oferta ?? p.precio_normal),
            en_oferta:    p.precio_oferta != null,
          })
        }
      }
    }

    return NextResponse.json({
      catalogo_item: {
        id:                   cat.id as number,
        nombre:               cat.nombre as string,
        imagen_url:           cat.imagen_url ?? null,
        pvp_sugerido:         cat.pvp_sugerido != null ? +cat.pvp_sugerido : null,
        precio_propio_actual,
      },
      competidores,
      catalogo_lista: catalogoLista,
    })
  } catch (err) {
    console.error('[proveedores/simulador]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

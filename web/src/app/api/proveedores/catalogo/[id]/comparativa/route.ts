import { createServiceClient } from '@/lib/supabase/service'
import { getProveedorAutenticadoODev } from '@/lib/supabase/auth-proveedor'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/proveedores/catalogo/[id]/comparativa
 *
 * Retorna precios de mi producto vs. competidores mapeados, por supermercado.
 * Agrupa los datos para facilitar el render de la tabla comparativa.
 *
 * Respuesta:
 * {
 *   enlazado: boolean,
 *   supermercados: ['walmart', 'donjuan', ...],
 *   filas: [
 *     { es_propio: true, etiqueta: 'Dove 90g', marca: 'Dove', tipo_relacion: null,
 *       factor_conversion: 1, precios: { walmart: { precio_normal, precio_oferta, en_oferta }, ... } },
 *     { es_propio: false, etiqueta: 'Palmolive 90g', marca: 'Palmolive',
 *       tipo_relacion: 'SUSTITUTO_DIRECTO', factor_conversion: 0.9,
 *       precios: { walmart: { ... } } },
 *   ]
 * }
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const proveedor = await getProveedorAutenticadoODev()
    if (!proveedor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { id } = await context.params
    const catalogoId = Number(id)
    if (isNaN(catalogoId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const db = createServiceClient()

    // Verificar propiedad
    const { data: catalogoRaw, error: catalogoErr } = await (db as any)
      .from('proveedor_catalogo')
      .select('id, producto_id, nombre, marca')
      .eq('id', catalogoId)
      .eq('proveedor_id', proveedor.id)
      .eq('activo', true)
      .single()

    if (catalogoErr || !catalogoRaw) {
      return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 })
    }

    const catalogo = catalogoRaw as any

    if (!catalogo.producto_id) {
      return NextResponse.json({
        enlazado: false,
        supermercados: [],
        filas: [],
        mensaje: 'Sin enlace EAN. Agrega un EAN-13 al producto para activar la comparativa automática.',
      })
    }

    // Llamar a la función Postgres
    const { data: rawRows, error: rpcErr } = await (db as any)
      .rpc('fn_comparativa_precios', { p_catalogo_id: catalogoId })

    if (rpcErr) {
      const isPendingMigration =
        rpcErr.code === 'PGRST202' ||
        rpcErr.message?.includes('does not exist') ||
        rpcErr.message?.includes('no existe')
      if (isPendingMigration) {
        return NextResponse.json({
          enlazado: true,
          supermercados: [],
          filas: [],
          mensaje: 'Comparativa disponible después del primer ciclo de scraping.',
        })
      }
      return NextResponse.json({ error: rpcErr.message }, { status: 500 })
    }

    const rows = (rawRows as any[] | null) ?? []

    if (rows.length === 0) {
      return NextResponse.json({
        enlazado: true,
        supermercados: [],
        filas: [],
        mensaje: 'El producto está enlazado pero aún no hay precios scraped. Los datos aparecerán después del próximo ciclo de scraping.',
      })
    }

    // ── Agrupar por producto (etiqueta+marca) → por supermercado ────────────
    // Collect unique supermarkets (in order of appearance)
    const supersSet = new Set<string>()
    rows.forEach((r: any) => supersSet.add(r.supermercado_key))
    const supermercados = Array.from(supersSet)

    // Build rows indexed by (es_propio, etiqueta, marca)
    const filasMap = new Map<string, any>()
    rows.forEach((r: any) => {
      const key = `${r.es_propio}|${r.etiqueta}|${r.marca}`
      if (!filasMap.has(key)) {
        filasMap.set(key, {
          es_propio:        r.es_propio,
          etiqueta:         r.etiqueta,
          marca:            r.marca,
          tipo_relacion:    r.tipo_relacion,
          factor_conversion: r.factor_conversion,
          precios:          {} as Record<string, any>,
        })
      }
      filasMap.get(key).precios[r.supermercado_key] = {
        supermercado_nombre: r.supermercado_nombre,
        precio_normal:       r.precio_normal,
        precio_oferta:       r.precio_oferta,
        en_oferta:           r.en_oferta,
        precio_normalizado:  r.precio_normalizado,
        fecha_hora:          r.fecha_hora,
      }
    })

    // Ensure own product appears first
    const filas = Array.from(filasMap.values()).sort((a, b) => {
      if (a.es_propio !== b.es_propio) return a.es_propio ? -1 : 1
      return a.etiqueta.localeCompare(b.etiqueta)
    })

    return NextResponse.json({ enlazado: true, supermercados, filas })
  } catch (err) {
    console.error('[catalogo/[id]/comparativa GET]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

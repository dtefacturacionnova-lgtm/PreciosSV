/**
 * GET /api/proveedores/comparativa
 *
 * Comparativa de precios basada en Mi Catálogo:
 *   - Productos propios: proveedor_catalogo
 *   - Competidores:      proveedor_competidores_catalogo (con competidor_producto_id)
 *
 * Agrupados por Categoría → SubCategoría (taxonomía libre del proveedor).
 * Incluye en_oferta + precio_normal para mostrar tachado en la UI.
 *
 * NOTE: precios_actuales es una vista materializada — PostgREST no puede inferir FKs.
 * Todos los joins se resuelven manualmente: productos → variantes → precios_actuales → supermercados.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { getProveedorAutenticadoODev } from '@/lib/supabase/auth-proveedor'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // ── 1. Proveedor ─────────────────────────────────────────
    const prov = await getProveedorAutenticadoODev()
    if (!prov) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const db = createServiceClient()

    // ── 2. Catálogo propio completo ───────────────────────────
    const { data: catalogoRaw } = await (db as any)
      .from('proveedor_catalogo')
      .select('id, nombre, marca, presentacion, gramaje, unidad, pvp_sugerido, producto_id, imagen_url, categoria, subcategoria')
      .eq('proveedor_id', prov.id)
      .eq('activo', true)
      .order('nombre')

    const catalogo = (catalogoRaw as any[] | null) ?? []

    if (catalogo.length === 0) {
      return NextResponse.json({
        grupos: [],
        supermercados: [],
        filtros: { marcas: [], categorias: [], subcategorias: [] },
        sin_datos: true,
      })
    }

    const catalogoIds = catalogo.map((c: any) => c.id as number)

    // ── 3. Competidores activos para todos los productos ──────
    const { data: compRaw } = await (db as any)
      .from('proveedor_competidores_catalogo')
      .select('id, producto_id, competidor_nombre, competidor_marca, tipo_relacion, factor_conversion, misma_presentacion, prioridad, competidor_producto_id')
      .in('producto_id', catalogoIds)
      .eq('activo', true)
      .order('prioridad')
      .order('competidor_nombre')

    const competidores = (compRaw as any[] | null) ?? []

    // ── 4. Todos los producto_ids que necesitamos pricear ─────
    const propiosIds = catalogo
      .filter((c: any) => c.producto_id != null)
      .map((c: any) => c.producto_id as number)

    const compIds = competidores
      .filter((c: any) => c.competidor_producto_id != null)
      .map((c: any) => c.competidor_producto_id as number)

    const allProdIds = [...new Set([...propiosIds, ...compIds])]

    // preciosPorProducto: producto_id → array of price rows with supermercado metadata
    const preciosPorProducto = new Map<number, any[]>()
    const superMap = new Map<number, { key: string; nombre: string; color: string }>()

    if (allProdIds.length > 0) {
      // 4a. Variantes activas
      const { data: varRaw } = await (db as any)
        .from('producto_variantes')
        .select('id, producto_id')
        .in('producto_id', allProdIds)
        .eq('activo', true)

      const variantes  = (varRaw as any[] | null) ?? []
      const varProdMap = new Map<number, number>(variantes.map((v: any) => [v.id, v.producto_id]))
      const varIds     = variantes.map((v: any) => v.id)

      if (varIds.length > 0) {
        // 4b. Precios actuales (raw — no embedded joins)
        const { data: paRaw } = await (db as any)
          .from('precios_actuales')
          .select('variante_id, supermercado_id, precio_normal, precio_oferta, en_oferta, descuento_pct, disponible')
          .in('variante_id', varIds)

        const paData = (paRaw as any[] | null) ?? []

        // 4c. Supermercados
        const superIds = [...new Set(paData.map((p: any) => p.supermercado_id as number))]
        if (superIds.length > 0) {
          const { data: superRaw } = await (db as any)
            .from('supermercados')
            .select('id, nombre, nombre_corto, color_hex')
            .in('id', superIds)

          for (const s of (superRaw as any[] | null) ?? []) {
            superMap.set(s.id, { key: s.nombre_corto, nombre: s.nombre, color: s.color_hex })
          }
        }

        // 4d. Build preciosPorProducto
        for (const pa of paData) {
          const prodId = varProdMap.get(pa.variante_id)
          if (prodId === undefined) continue
          const s = superMap.get(pa.supermercado_id)
          if (!preciosPorProducto.has(prodId)) preciosPorProducto.set(prodId, [])
          preciosPorProducto.get(prodId)!.push({
            supermercado_id: pa.supermercado_id,
            supermercado:    s?.nombre ?? '—',
            key:             s?.key    ?? '',
            color:           s?.color  ?? '#94a3b8',
            precio_normal:   +pa.precio_normal,
            precio_oferta:   pa.precio_oferta != null ? +pa.precio_oferta : null,
            en_oferta:       pa.en_oferta,
            descuento_pct:   pa.descuento_pct != null ? +pa.descuento_pct : null,
            disponible:      pa.disponible,
          })
        }
      }
    }

    // ── 5. Competidores por catalogo_id con sus precios ───────
    const compByCatalogo = new Map<number, any[]>()
    for (const comp of competidores) {
      if (!compByCatalogo.has(comp.producto_id)) compByCatalogo.set(comp.producto_id, [])
      const precios = comp.competidor_producto_id != null
        ? (preciosPorProducto.get(comp.competidor_producto_id) ?? [])
        : []
      compByCatalogo.get(comp.producto_id)!.push({
        id:                 comp.id,
        nombre:             comp.competidor_nombre,
        marca:              comp.competidor_marca,
        tipo_relacion:      comp.tipo_relacion,
        factor_conversion:  comp.factor_conversion,
        misma_presentacion: comp.misma_presentacion,
        prioridad:          comp.prioridad,
        enlazado:           comp.competidor_producto_id != null,
        precios,
      })
    }

    // ── 6. Agrupar por categoría → subcategoría ───────────────
    type Grupo = {
      categoria:    string | null
      subcategoria: string | null
      productos:    any[]
    }
    const gruposMap = new Map<string, Grupo>()

    for (const c of catalogo) {
      // Use high-unicode char as separator to avoid collision with user data
      const key = `${c.categoria ?? ''}\x00${c.subcategoria ?? ''}`
      if (!gruposMap.has(key)) {
        gruposMap.set(key, {
          categoria:    c.categoria    ?? null,
          subcategoria: c.subcategoria ?? null,
          productos:    [],
        })
      }

      const descripcion = [
        c.presentacion,
        c.gramaje ? `${c.gramaje}${c.unidad ?? ''}` : null,
      ].filter(Boolean).join(' ')

      gruposMap.get(key)!.productos.push({
        catalogo_id:    c.id,
        nombre:         c.nombre,
        marca:          c.marca,
        descripcion,
        imagen_url:     c.imagen_url,
        pvp_sugerido:   c.pvp_sugerido != null ? +c.pvp_sugerido : null,
        enlazado:       !!c.producto_id,
        precios_propio: c.producto_id != null
          ? (preciosPorProducto.get(c.producto_id) ?? [])
          : [],
        competidores:   compByCatalogo.get(c.id) ?? [],
      })
    }

    // Sort: categorías con nombre primero, luego sin categoría
    const grupos: Grupo[] = Array.from(gruposMap.values()).sort((a, b) => {
      const ca = a.categoria ?? '￿'
      const cb = b.categoria ?? '￿'
      if (ca !== cb) return ca.localeCompare(cb, 'es')
      const sa = a.subcategoria ?? '￿'
      const sb = b.subcategoria ?? '￿'
      return sa.localeCompare(sb, 'es')
    })

    // ── 7. Supermercados en orden de aparición ────────────────
    const supermercados = Array.from(superMap.values())

    // ── 8. Opciones de filtro ─────────────────────────────────
    const marcas = [...new Set(catalogo.map((c: any) => c.marca as string))].sort((a, b) => a.localeCompare(b, 'es'))
    const categorias = [...new Set(
      catalogo.filter((c: any) => c.categoria).map((c: any) => c.categoria as string)
    )].sort((a, b) => a.localeCompare(b, 'es'))
    const subcategorias = [...new Set(
      catalogo.filter((c: any) => c.subcategoria).map((c: any) => c.subcategoria as string)
    )].sort((a, b) => a.localeCompare(b, 'es'))

    return NextResponse.json({
      grupos,
      supermercados,
      filtros: { marcas, categorias, subcategorias },
      sin_datos: false,
    })
  } catch (err) {
    console.error('[proveedores/comparativa]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const revalidate = 300 // 5 minutos

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q            = (searchParams.get('q') ?? '').trim()
  const catSlug      = searchParams.get('categoria') ?? ''
  const superKey     = searchParams.get('supermercado') ?? ''
  const soloOfertas  = searchParams.get('solo_ofertas') === 'true'
  const orden        = searchParams.get('orden') ?? 'relevancia'
  const page         = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const pageSize     = 24
  const offset       = (page - 1) * pageSize

  try {
    const supabase = await createClient()

    // ── 1. Buscar productos por nombre/marca ──────────────
    let prodQuery = supabase
      .from('productos')
      .select('id, nombre_normalizado, marca, imagen_url, categorias!inner(id, nombre, slug)', { count: 'exact' })
      .eq('activo', true)

    if (q) prodQuery = prodQuery.or(`nombre_normalizado.ilike.%${q}%,marca.ilike.%${q}%`)
    if (catSlug) prodQuery = prodQuery.eq('categorias.slug', catSlug)

    const { data: prodRaw, count, error: eProd } = await prodQuery
    if (eProd) throw eProd
    const productos = prodRaw as any[] | null
    if (!productos?.length) return NextResponse.json({ resultados: [], total: 0, page, pages: 0 })

    // ── 2. Precios actuales para esos productos ───────────
    let precioQuery = supabase
      .from('precios_actuales')
      .select('producto_id, precio_normal, precio_oferta, en_oferta, descuento_pct, supermercados!inner(nombre, nombre_corto, color_hex)')
      .in('producto_id', productos.map(p => p.id))

    if (superKey) precioQuery = precioQuery.eq('supermercados.nombre_corto', superKey)
    if (soloOfertas) precioQuery = precioQuery.eq('en_oferta', true)

    const { data: precRaw, error: ePrec } = await precioQuery
    if (ePrec) throw ePrec
    const precios = precRaw as any[] | null

    // ── 3. Agrupar precios por producto ───────────────────
    const precioMap = new Map<number, {
      precio_min: number; precio_max: number; en_oferta: boolean
      descuento_max: number | null; tiendas: number
      supermercado_mas_barato: string; color_mas_barato: string
    }>()

    for (const p of precios ?? []) {
      const efectivo = (p.precio_oferta ?? p.precio_normal) as number
      const super_   = p.supermercados as any
      const prev = precioMap.get(p.producto_id)

      if (!prev || efectivo < prev.precio_min) {
        precioMap.set(p.producto_id, {
          precio_min: efectivo,
          precio_max: prev ? Math.max(prev.precio_max, p.precio_normal) : p.precio_normal,
          en_oferta: p.en_oferta || (prev?.en_oferta ?? false),
          descuento_max: Math.max(p.descuento_pct ?? 0, prev?.descuento_max ?? 0) || null,
          tiendas: (prev?.tiendas ?? 0) + 1,
          supermercado_mas_barato: super_.nombre,
          color_mas_barato: super_.color_hex,
        })
      } else {
        precioMap.set(p.producto_id, {
          ...prev,
          precio_max: Math.max(prev.precio_max, p.precio_normal),
          en_oferta: prev.en_oferta || p.en_oferta,
          descuento_max: Math.max(p.descuento_pct ?? 0, prev.descuento_max ?? 0) || null,
          tiendas: prev.tiendas + 1,
        })
      }
    }

    // ── 4. Filtrar productos sin precio (si filtro activo) ─
    let resultados = productos
      .filter(p => !superKey && !soloOfertas ? true : precioMap.has(p.id))
      .map(p => {
        const precio = precioMap.get(p.id)
        const cat = p.categorias as any
        return {
          id: p.id,
          nombre_normalizado: p.nombre_normalizado,
          marca: p.marca,
          imagen_url: p.imagen_url,
          categoria_nombre: cat?.nombre ?? null,
          precio_min: precio?.precio_min ?? null,
          precio_max: precio?.precio_max ?? null,
          en_oferta: precio?.en_oferta ?? false,
          descuento_max: precio?.descuento_max ?? null,
          tiendas: precio?.tiendas ?? 0,
          supermercado_mas_barato: precio?.supermercado_mas_barato ?? null,
          color_mas_barato: precio?.color_mas_barato ?? null,
        }
      })

    // ── 5. Ordenar ─────────────────────────────────────────
    if (orden === 'precio_asc') resultados.sort((a, b) => (a.precio_min ?? 99) - (b.precio_min ?? 99))
    if (orden === 'precio_desc') resultados.sort((a, b) => (b.precio_min ?? 0) - (a.precio_min ?? 0))
    if (orden === 'descuento') resultados.sort((a, b) => (b.descuento_max ?? 0) - (a.descuento_max ?? 0))

    // ── 6. Paginar ─────────────────────────────────────────
    const totalFiltrado = resultados.length
    resultados = resultados.slice(offset, offset + pageSize)

    return NextResponse.json({
      resultados,
      total: totalFiltrado,
      page,
      pages: Math.ceil(totalFiltrado / pageSize),
    })
  } catch (err) {
    console.error('[buscar]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

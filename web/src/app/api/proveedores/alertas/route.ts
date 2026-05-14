/**
 * GET /api/proveedores/alertas
 * Detecta cuando un competidor lanza una oferta:
 *   - Ofertas activas de marcas competidoras (precios_actuales, en_oferta = true)
 *   - Para cada una, busca la primera aparición de en_oferta=true en los últimos 7 días
 *     → si <= 48 h: "nueva", <= 96 h: "reciente", else: "vigente"
 */
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const db = createServiceClient()

    const { data: uRaw } = await db.from('usuarios').select('id,rol').eq('auth_id', user.id).single()
    const u = uRaw as any
    if (!u || (u.rol !== 'proveedor' && u.rol !== 'admin'))
      return NextResponse.json({ error: 'Acceso denegado' }, { status: 403 })

    const { data: pRaw } = await db
      .from('proveedores')
      .select('id,marcas,competidores')
      .eq('usuario_id', u.id)
      .single()
    const prov = pRaw as any
    if (!prov) return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 })

    const marcasPropias: string[] = prov.marcas ?? []
    const competidores: string[]  = prov.competidores ?? []

    if (competidores.length === 0) {
      return NextResponse.json({ alertas: [], total_ofertas: 0, tiene_competidores: false })
    }

    // ── 1. Ofertas activas de competidores ───────────────────────
    const { data: ofertasRaw } = await db
      .from('precios_actuales')
      .select(`
        variante_id,
        producto_id,
        precio_normal, precio_oferta, en_oferta, descuento_pct,
        supermercados!inner(nombre, nombre_corto, color_hex),
        producto_variantes!inner(producto_id, activo),
        productos!inner(nombre_normalizado, marca, imagen_url, activo, categorias(nombre))
      `)
      .in('productos.marca', competidores)
      .eq('en_oferta', true)
      .eq('productos.activo', true)
      .eq('producto_variantes.activo', true)
      .order('descuento_pct', { ascending: false })

    const filas = (ofertasRaw as any[] | null) ?? []
    if (filas.length === 0) {
      return NextResponse.json({ alertas: [], total_ofertas: 0, tiene_competidores: true })
    }

    // ── 2. Cuándo comenzó cada oferta (última vez que en_oferta se puso en true) ──
    const varianteIds = filas.map(f => f.variante_id)
    const hace7dias   = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: iniciosRaw } = await db
      .from('precios')
      .select('variante_id, fecha_hora')
      .in('variante_id', varianteIds)
      .eq('en_oferta', true)
      .gte('fecha_hora', hace7dias)
      .order('fecha_hora', { ascending: true })

    // Primera fecha de en_oferta=true en últimos 7d → inicio de la promo
    const inicioOferta = new Map<number, string>()
    for (const r of (iniciosRaw as any[] | null) ?? []) {
      if (!inicioOferta.has(r.variante_id)) inicioOferta.set(r.variante_id, r.fecha_hora)
    }

    // ── 3. Agrupar por marca, calcular antigüedad ────────────────
    type Alerta = {
      marca:   string
      total:   number
      ofertas: {
        producto_id:   number
        variante_id:   number
        nombre:        string
        imagen_url:    string | null
        categoria:     string | null
        supermercado:  string
        key:           string
        color:         string
        precio_normal: number
        precio_oferta: number | null
        descuento_pct: number | null
        inicio_oferta: string | null
        horas_activa:  number | null
        estado:        'nueva' | 'reciente' | 'vigente'
      }[]
    }

    const porMarca: Record<string, Alerta> = {}

    for (const f of filas) {
      const marca: string = f.productos?.marca
      if (!marca) continue

      if (!porMarca[marca]) porMarca[marca] = { marca, total: 0, ofertas: [] }

      const inicio     = inicioOferta.get(f.variante_id) ?? null
      const horasActiva = inicio
        ? Math.round((Date.now() - new Date(inicio).getTime()) / 3_600_000)
        : null

      const estadoOferta: 'nueva' | 'reciente' | 'vigente' =
        horasActiva !== null && horasActiva <= 48 ? 'nueva'    :
        horasActiva !== null && horasActiva <= 96 ? 'reciente' :
        'vigente'

      porMarca[marca].total++
      porMarca[marca].ofertas.push({
        producto_id:   f.producto_id,
        variante_id:   f.variante_id,
        nombre:        f.productos?.nombre_normalizado ?? '—',
        imagen_url:    f.productos?.imagen_url ?? null,
        categoria:     f.productos?.categorias?.nombre ?? null,
        supermercado:  f.supermercados?.nombre ?? '—',
        key:           f.supermercados?.nombre_corto ?? '',
        color:         f.supermercados?.color_hex ?? '#94a3b8',
        precio_normal: +f.precio_normal,
        precio_oferta: f.precio_oferta != null ? +f.precio_oferta : null,
        descuento_pct: f.descuento_pct  != null ? +f.descuento_pct : null,
        inicio_oferta: inicio,
        horas_activa:  horasActiva,
        estado:        estadoOferta,
      })
    }

    const alertas = Object.values(porMarca).sort((a, b) => b.total - a.total)

    return NextResponse.json({
      alertas,
      total_ofertas:      filas.length,
      tiene_competidores: true,
    })
  } catch (err) {
    console.error('[proveedores/alertas]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

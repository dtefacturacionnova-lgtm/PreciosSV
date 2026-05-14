import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const revalidate = 0

export async function GET() {
  try {
    const supabase = await createClient()

    // Verificar sesión
    const { data: { user }, error: eAuth } = await supabase.auth.getUser()
    if (eAuth || !user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // Obtener perfil + proveedor
    const { data: usuarioRaw } = await supabase
      .from('usuarios')
      .select('id, nombre, rol')
      .eq('auth_id', user.id)
      .single()
    const usuario = usuarioRaw as any

    if (!usuario) return NextResponse.json({ error: 'Perfil no encontrado' }, { status: 404 })
    if (usuario.rol !== 'proveedor' && usuario.rol !== 'admin') {
      return NextResponse.json({ error: 'Acceso denegado' }, { status: 403 })
    }

    const { data: proveedorRaw } = await supabase
      .from('proveedores')
      .select('id, razon_social, marcas')
      .eq('usuario_id', usuario.id)
      .single()
    const proveedor = proveedorRaw as any

    if (!proveedor) return NextResponse.json({ error: 'Proveedor no registrado' }, { status: 404 })

    const marcas = proveedor.marcas ?? []

    // ── Productos del proveedor ───────────────────────────────
    const { data: productosRaw } = await supabase
      .from('productos')
      .select(`
        id, nombre_normalizado, marca, imagen_url, activo,
        categorias(nombre),
        precios_actuales(
          precio_normal, precio_oferta, en_oferta, descuento_pct, disponible,
          supermercados(nombre, nombre_corto, color_hex)
        )
      `)
      .in('marca', marcas)
      .eq('activo', true)
      .order('nombre_normalizado')

    const productosData = (productosRaw as any[] | null) ?? []

    // ── Métricas ──────────────────────────────────────────────
    let totalOfertas = 0
    let totalProductosConPrecio = 0
    const tiendasSet = new Set<string>()
    let sumDescuentos = 0
    let countDescuentos = 0

    for (const prod of productosData) {
      const precios = (prod.precios_actuales ?? []) as any[]
      if (precios.length > 0) totalProductosConPrecio++
      for (const p of precios) {
        const s = p.supermercados as any
        if (s?.nombre_corto) tiendasSet.add(s.nombre_corto)
        if (p.en_oferta) totalOfertas++
        if (p.descuento_pct) { sumDescuentos += p.descuento_pct; countDescuentos++ }
      }
    }

    const metricas = {
      productos_activos:  productosData.length,
      productos_con_precio: totalProductosConPrecio,
      ofertas_activas:    totalOfertas,
      tiendas_presencia:  tiendasSet.size,
      descuento_promedio: countDescuentos ? +(sumDescuentos / countDescuentos).toFixed(1) : null,
    }

    // ── Tabla de productos con precios por tienda ─────────────
    const tabla = productosData.map(prod => {
      const precios = (prod.precios_actuales ?? []) as any[]
      const precioMinObj = precios.reduce((min: any, p: any) => {
        const ef = p.precio_oferta ?? p.precio_normal
        const prevEf = min ? (min.precio_oferta ?? min.precio_normal) : Infinity
        return ef < prevEf ? p : min
      }, null)

      return {
        id:                 prod.id,
        nombre:             prod.nombre_normalizado,
        marca:              prod.marca,
        imagen_url:         prod.imagen_url,
        categoria:          (prod.categorias as any)?.nombre ?? null,
        precio_min:         precioMinObj ? +(precioMinObj.precio_oferta ?? precioMinObj.precio_normal) : null,
        en_oferta:          precios.some((p: any) => p.en_oferta),
        descuento_max:      precios.reduce((m: number, p: any) => Math.max(m, p.descuento_pct ?? 0), 0) || null,
        tiendas:            precios.length,
        tienda_mas_barata:  precioMinObj ? (precioMinObj.supermercados as any)?.nombre : null,
        color_mas_barata:   precioMinObj ? (precioMinObj.supermercados as any)?.color_hex : null,
        precios_por_tienda: precios.map((p: any) => ({
          supermercado:  (p.supermercados as any)?.nombre,
          key:           (p.supermercados as any)?.nombre_corto,
          color:         (p.supermercados as any)?.color_hex,
          precio_normal: +p.precio_normal,
          precio_oferta: p.precio_oferta ? +p.precio_oferta : null,
          en_oferta:     p.en_oferta,
          descuento_pct: p.descuento_pct ? +p.descuento_pct : null,
          disponible:    p.disponible,
        })),
      }
    })

    return NextResponse.json({
      proveedor: { razon_social: proveedor.razon_social, marcas },
      metricas,
      tabla,
    })
  } catch (err) {
    console.error('[proveedores/dashboard]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

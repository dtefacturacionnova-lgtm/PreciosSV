/**
 * GET /api/proveedores/cumplimiento
 * Monitorea si los supermercados respetan el PVP sugerido por el proveedor.
 * Compara precios actuales vs. proveedor_precios_referencia.
 */
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const UMBRAL_PCT = 5 // ±5 % de tolerancia

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
      .select('id,marcas')
      .eq('usuario_id', u.id)
      .single()
    const prov = pRaw as any
    if (!prov) return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 })

    const marcas: string[] = prov.marcas ?? []
    if (marcas.length === 0) {
      return NextResponse.json({ productos: [], resumen_global: { total_ok: 0, total_alto: 0, total_bajo: 0, total_sin_referencia: 0 } })
    }

    // ── Productos con precios actuales ───────────────────────────
    const { data: productosRaw } = await db
      .from('productos')
      .select(`
        id, nombre_normalizado, marca, imagen_url,
        precios_actuales(
          precio_normal, precio_oferta, en_oferta, descuento_pct,
          supermercados(nombre, nombre_corto, color_hex)
        )
      `)
      .in('marca', marcas)
      .eq('activo', true)
      .order('nombre_normalizado')

    const productos = (productosRaw as any[] | null) ?? []
    const productIds = productos.map((p: any) => p.id)

    // ── Referencias del proveedor ────────────────────────────────
    const { data: refRaw } = productIds.length
      ? await db
          .from('proveedor_precios_referencia')
          .select('producto_id, precio_sugerido, precio_promo, en_promocion')
          .eq('proveedor_id', prov.id)
          .in('producto_id', productIds)
      : { data: [] }

    const refMap = new Map<number, {
      precio_sugerido: number | null
      precio_promo:    number | null
      en_promocion:    boolean
    }>()
    for (const r of (refRaw as any[] | null) ?? []) {
      refMap.set(r.producto_id, {
        precio_sugerido: r.precio_sugerido != null ? +r.precio_sugerido : null,
        precio_promo:    r.precio_promo    != null ? +r.precio_promo    : null,
        en_promocion:    r.en_promocion ?? false,
      })
    }

    let total_ok = 0, total_alto = 0, total_bajo = 0, total_sin_referencia = 0

    const resultado = productos.map((prod: any) => {
      const ref = refMap.get(prod.id) ?? null

      // Precio de referencia activo (usa precio_promo si está en promoción)
      const precioRef: number | null = ref
        ? (ref.en_promocion && ref.precio_promo != null
            ? ref.precio_promo
            : ref.precio_sugerido)
        : null

      const tiendas = ((prod.precios_actuales ?? []) as any[]).map((p: any) => {
        const s = p.supermercados as any
        const precioEfectivo = +(p.precio_oferta ?? p.precio_normal)

        let desviacion_pct: number | null = null
        let estado: 'ok' | 'alto' | 'bajo' | 'sin_referencia' = 'sin_referencia'

        if (precioRef !== null) {
          desviacion_pct = +((precioEfectivo - precioRef) / precioRef * 100).toFixed(1)
          if (desviacion_pct > UMBRAL_PCT) {
            estado = 'alto'; total_alto++
          } else if (desviacion_pct < -UMBRAL_PCT) {
            estado = 'bajo'; total_bajo++
          } else {
            estado = 'ok'; total_ok++
          }
        } else {
          total_sin_referencia++
        }

        return {
          supermercado:      s?.nombre ?? '—',
          key:               s?.nombre_corto ?? '',
          color:             s?.color_hex ?? '#94a3b8',
          precio_normal:     +p.precio_normal,
          precio_oferta:     p.precio_oferta != null ? +p.precio_oferta : null,
          en_oferta:         p.en_oferta,
          precio_efectivo:   precioEfectivo,
          precio_referencia: precioRef,
          desviacion_pct,
          estado,
        }
      })

      const resumen = tiendas.reduce(
        (acc: Record<string, number>, t: any) => {
          acc[t.estado] = (acc[t.estado] ?? 0) + 1
          return acc
        },
        { ok: 0, alto: 0, bajo: 0, sin_referencia: 0 }
      )

      return {
        id:              prod.id,
        nombre:          prod.nombre_normalizado,
        marca:           prod.marca,
        imagen_url:      prod.imagen_url,
        precio_sugerido: ref?.precio_sugerido ?? null,
        precio_promo:    ref?.precio_promo    ?? null,
        en_promocion:    ref?.en_promocion    ?? false,
        tiendas,
        resumen,
      }
    })

    return NextResponse.json({
      productos: resultado,
      resumen_global: { total_ok, total_alto, total_bajo, total_sin_referencia },
    })
  } catch (err) {
    console.error('[proveedores/cumplimiento]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

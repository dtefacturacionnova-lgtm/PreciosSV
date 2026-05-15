/**
 * GET /api/proveedores/cumplimiento
 *
 * Monitorea si los supermercados respetan el PVP sugerido del proveedor.
 * Fuente del PVP: proveedor_catalogo.pvp_sugerido (ingresado por el proveedor).
 * Fuente de precios reales: precios_actuales (scraped) → via producto_id.
 * Tolerancia: ±5 % por defecto.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const UMBRAL_PCT = 5  // tolerancia ±5 %

export async function GET() {
  try {
    const db = createServiceClient()

    // ── 1. Proveedor ─────────────────────────────────────────────
    const { data: pRaw } = await db
      .from('proveedores')
      .select('id')
      .limit(1)
      .single()
    const prov = pRaw as any
    if (!prov) return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 })

    // ── 2. Catálogo propio con PVP sugerido y EAN enlazado ───────
    const { data: catalogoRaw } = await (db as any)
      .from('proveedor_catalogo')
      .select('id, nombre, marca, presentacion, gramaje, unidad, pvp_sugerido, producto_id, imagen_url')
      .eq('proveedor_id', prov.id)
      .eq('activo', true)
      .not('pvp_sugerido', 'is', null)
      .order('nombre')

    const catalogo = (catalogoRaw as any[] | null) ?? []

    if (catalogo.length === 0) {
      return NextResponse.json({
        productos: [],
        resumen_global: { total_ok: 0, total_alto: 0, total_bajo: 0, total_sin_datos: 0 },
        sin_datos: true,
        mensaje: 'Agrega productos con PVP sugerido en "Mi Catálogo" para activar el monitoreo.',
      })
    }

    // ── 3. IDs de productos enlazados en el sistema de precios ───
    const enlazados = catalogo.filter((c: any) => c.producto_id != null)
    const productoIds = enlazados.map((c: any) => c.producto_id as number)

    // Precios actuales por supermercado (solo para productos enlazados)
    let preciosPorProducto: Map<number, any[]> = new Map()

    if (productoIds.length > 0) {
      const { data: prodRaw } = await (db as any)
        .from('productos')
        .select(`
          id,
          precios_actuales(
            precio_normal, precio_oferta, en_oferta, descuento_pct, disponible,
            supermercados(nombre, nombre_corto, color_hex)
          )
        `)
        .in('id', productoIds)

      for (const prod of (prodRaw as any[] | null) ?? []) {
        preciosPorProducto.set(prod.id, prod.precios_actuales ?? [])
      }
    }

    // ── 4. Construir resultado por producto ───────────────────────
    let total_ok = 0, total_alto = 0, total_bajo = 0, total_sin_datos = 0

    const resultado = catalogo.map((c: any) => {
      const pvp = c.pvp_sugerido != null ? +c.pvp_sugerido : null
      const precios: any[] = preciosPorProducto.get(c.producto_id) ?? []

      const descripcion = [
        c.presentacion,
        c.gramaje ? `${c.gramaje}${c.unidad ?? ''}` : null,
      ].filter(Boolean).join(' ')

      if (precios.length === 0) {
        total_sin_datos++
        return {
          catalogo_id:     c.id,
          nombre:          c.nombre,
          marca:           c.marca,
          descripcion,
          imagen_url:      c.imagen_url,
          pvp_sugerido:    pvp,
          enlazado:        !!c.producto_id,
          tiendas:         [],
          resumen:         { ok: 0, alto: 0, bajo: 0, sin_datos: 1 },
        }
      }

      const tiendas = precios.map((p: any) => {
        const s = p.supermercados as any
        const precioEfectivo = +(p.precio_oferta ?? p.precio_normal)

        let desviacion_pct: number | null = null
        let estado: 'ok' | 'alto' | 'bajo' | 'sin_datos' = 'sin_datos'

        if (pvp !== null) {
          desviacion_pct = +((precioEfectivo - pvp) / pvp * 100).toFixed(1)
          if (desviacion_pct > UMBRAL_PCT) {
            estado = 'alto'; total_alto++
          } else if (desviacion_pct < -UMBRAL_PCT) {
            estado = 'bajo'; total_bajo++
          } else {
            estado = 'ok'; total_ok++
          }
        } else {
          total_sin_datos++
        }

        return {
          supermercado:     s?.nombre    ?? '—',
          key:              s?.nombre_corto ?? '',
          color:            s?.color_hex   ?? '#94a3b8',
          precio_normal:    +p.precio_normal,
          precio_oferta:    p.precio_oferta != null ? +p.precio_oferta : null,
          en_oferta:        p.en_oferta,
          precio_efectivo:  precioEfectivo,
          pvp_sugerido:     pvp,
          desviacion_pct,
          estado,
        }
      })

      const resumen = tiendas.reduce(
        (acc: Record<string, number>, t: any) => {
          acc[t.estado] = (acc[t.estado] ?? 0) + 1
          return acc
        },
        { ok: 0, alto: 0, bajo: 0, sin_datos: 0 }
      )

      return {
        catalogo_id:     c.id,
        nombre:          c.nombre,
        marca:           c.marca,
        descripcion,
        imagen_url:      c.imagen_url,
        pvp_sugerido:    pvp,
        enlazado:        !!c.producto_id,
        tiendas,
        resumen,
      }
    })

    return NextResponse.json({
      productos: resultado,
      resumen_global: { total_ok, total_alto, total_bajo, total_sin_datos },
      sin_datos: false,
    })
  } catch (err) {
    console.error('[proveedores/cumplimiento]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

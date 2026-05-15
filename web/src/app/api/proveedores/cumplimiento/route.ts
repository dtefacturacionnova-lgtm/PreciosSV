/**
 * GET /api/proveedores/cumplimiento
 *
 * Monitorea si los supermercados respetan el PVP sugerido del proveedor.
 * Fuente del PVP: proveedor_catalogo.pvp_sugerido (ingresado por el proveedor).
 * Fuente de precios reales: precios_actuales (scraped) → via producto_id.
 * Tolerancia: ±5 % por defecto.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { getProveedorAutenticadoODev } from '@/lib/supabase/auth-proveedor'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const UMBRAL_PCT = 5  // tolerancia ±5 %

export async function GET() {
  try {
    // ── 1. Proveedor ─────────────────────────────────────────────
    const prov = await getProveedorAutenticadoODev()
    if (!prov) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const db = createServiceClient()

    // ── 2. Catálogo propio completo ───────────────────────────────
    // Se muestran TODOS los productos del catálogo (con y sin PVP).
    // Los sin PVP aparecen con el botón "+ Agregar PVP" en el componente.
    const { data: catalogoRaw } = await (db as any)
      .from('proveedor_catalogo')
      .select('id, nombre, marca, presentacion, gramaje, unidad, pvp_sugerido, producto_id, imagen_url')
      .eq('proveedor_id', prov.id)
      .eq('activo', true)
      .order('nombre')

    const catalogo = (catalogoRaw as any[] | null) ?? []

    if (catalogo.length === 0) {
      return NextResponse.json({
        productos: [],
        resumen_global: { total_ok: 0, total_alto: 0, total_bajo: 0, total_sin_datos: 0 },
        sin_datos: true,
        mensaje: 'Agrega productos en "Mi Catálogo" para activar el monitoreo.',
      })
    }

    // ── 3. Precios actuales para productos enlazados ──────────────
    // Manual joins — precios_actuales is a materialized view; PostgREST cannot infer FKs.
    const enlazados   = catalogo.filter((c: any) => c.producto_id != null)
    const productoIds = enlazados.map((c: any) => c.producto_id as number)

    // preciosPorProducto: producto_id → array of { supermercados, precio_normal, ... }
    let preciosPorProducto: Map<number, any[]> = new Map()

    if (productoIds.length > 0) {
      // 3a. Variantes activas para esos productos
      const { data: varRaw } = await (db as any)
        .from('producto_variantes')
        .select('id, producto_id')
        .in('producto_id', productoIds)
        .eq('activo', true)

      const variantes  = (varRaw as any[] | null) ?? []
      const varProdMap = new Map<number, number>(variantes.map((v: any) => [v.id, v.producto_id]))
      const varIds     = variantes.map((v: any) => v.id)

      if (varIds.length > 0) {
        // 3b. Precios actuales (raw columns only)
        const { data: paRaw } = await (db as any)
          .from('precios_actuales')
          .select('variante_id, supermercado_id, precio_normal, precio_oferta, en_oferta, descuento_pct, disponible')
          .in('variante_id', varIds)

        const paData = (paRaw as any[] | null) ?? []

        // 3c. Supermercados
        const superIds = [...new Set(paData.map((p: any) => p.supermercado_id))]
        const superMap = new Map<number, { nombre: string; nombre_corto: string; color_hex: string }>()
        if (superIds.length > 0) {
          const { data: superRaw } = await (db as any)
            .from('supermercados')
            .select('id, nombre, nombre_corto, color_hex')
            .in('id', superIds)
          for (const s of (superRaw as any[] | null) ?? []) {
            superMap.set(s.id, { nombre: s.nombre, nombre_corto: s.nombre_corto, color_hex: s.color_hex })
          }
        }

        // 3d. Build preciosPorProducto in the same shape the downstream code expects
        for (const pa of paData) {
          const prodId = varProdMap.get(pa.variante_id)
          if (prodId === undefined) continue
          const s = superMap.get(pa.supermercado_id) ?? null
          if (!preciosPorProducto.has(prodId)) preciosPorProducto.set(prodId, [])
          preciosPorProducto.get(prodId)!.push({
            precio_normal: pa.precio_normal,
            precio_oferta: pa.precio_oferta,
            en_oferta:     pa.en_oferta,
            descuento_pct: pa.descuento_pct,
            disponible:    pa.disponible,
            supermercados: s,   // same shape as the embedded-join result
          })
        }
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

      if (pvp === null) {
        // Sin PVP registrado: no se puede monitorear, se muestra con CTA para añadir PVP
        return {
          catalogo_id:  c.id,
          nombre:       c.nombre,
          marca:        c.marca,
          descripcion,
          imagen_url:   c.imagen_url,
          pvp_sugerido: null,
          enlazado:     !!c.producto_id,
          tiendas:      precios.length > 0 ? precios.map((p: any) => {
            const s = p.supermercados as any
            const precioEfectivo = +(p.precio_oferta ?? p.precio_normal)
            return {
              supermercado:    s?.nombre    ?? '—',
              key:             s?.nombre_corto ?? '',
              color:           s?.color_hex   ?? '#94a3b8',
              precio_normal:   +p.precio_normal,
              precio_oferta:   p.precio_oferta != null ? +p.precio_oferta : null,
              en_oferta:       p.en_oferta,
              precio_efectivo: precioEfectivo,
              pvp_sugerido:    null,
              desviacion_pct:  null,
              estado:          'sin_datos' as const,
            }
          }) : [],
          resumen: { ok: 0, alto: 0, bajo: 0, sin_datos: Math.max(precios.length, 1) },
        }
      }

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

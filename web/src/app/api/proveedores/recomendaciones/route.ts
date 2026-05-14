/**
 * GET /api/proveedores/recomendaciones
 * Genera recomendaciones de pricing determinísticas basadas en
 * posición del precio propio vs. el mercado de competidores.
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
    const competidores:  string[] = prov.competidores ?? []

    if (marcasPropias.length === 0 || competidores.length === 0) {
      return NextResponse.json({ recomendaciones: [], total: 0 })
    }

    // ── 1. Productos propios con imagen ───────────────────────────
    const { data: prodPropiosRaw } = await db
      .from('productos')
      .select('id, nombre, imagen_url, marca')
      .in('marca', marcasPropias)
      .eq('activo', true)

    const prodPropios = (prodPropiosRaw as any[] | null) ?? []
    if (prodPropios.length === 0) {
      return NextResponse.json({ recomendaciones: [], total: 0 })
    }

    // ── 2. Variantes de productos propios ─────────────────────────
    const propiosIds = prodPropios.map((p: any) => p.id)
    const { data: varPropiosRaw } = await db
      .from('producto_variantes')
      .select('id, producto_id')
      .in('producto_id', propiosIds)
      .eq('activo', true)

    const varPropios = (varPropiosRaw as any[] | null) ?? []
    const varPropiosIds = varPropios.map((v: any) => v.id)
    const varPropiosMap = new Map<number, number>(
      varPropios.map((v: any) => [v.id, v.producto_id])
    )

    // ── 3. Precios actuales de productos propios ──────────────────
    const { data: preciosPropiosRaw } = await db
      .from('precios_actuales')
      .select('variante_id, precio_normal, precio_oferta')
      .in('variante_id', varPropiosIds)

    const preciosPropios = (preciosPropiosRaw as any[] | null) ?? []

    // Precio efectivo promedio por producto_id (propio)
    const precioPorProducto = new Map<number, number[]>()
    for (const pp of preciosPropios) {
      const prodId = varPropiosMap.get(pp.variante_id as number)
      if (prodId === undefined) continue
      const precio = +(pp.precio_oferta ?? pp.precio_normal)
      if (!precioPorProducto.has(prodId)) precioPorProducto.set(prodId, [])
      precioPorProducto.get(prodId)!.push(precio)
    }

    // ── 4. Productos competidores que coinciden por nombre ────────
    // Estrategia: obtener precios actuales de marcas competidoras
    const { data: prodCompRaw } = await db
      .from('productos')
      .select('id, nombre, marca')
      .in('marca', competidores)
      .eq('activo', true)

    const prodComp = (prodCompRaw as any[] | null) ?? []
    const compIds  = prodComp.map((p: any) => p.id)
    const compNombres = new Map<number, string>(
      prodComp.map((p: any) => [p.id, p.nombre as string])
    )

    const { data: varCompRaw } = await db
      .from('producto_variantes')
      .select('id, producto_id')
      .in('producto_id', compIds)
      .eq('activo', true)

    const varComp = (varCompRaw as any[] | null) ?? []
    const varCompIds = varComp.map((v: any) => v.id)
    const varCompMap = new Map<number, number>(
      varComp.map((v: any) => [v.id, v.producto_id])
    )

    const { data: preciosCompRaw } = await db
      .from('precios_actuales')
      .select('variante_id, precio_normal, precio_oferta')
      .in('variante_id', varCompIds)

    // Precios de competidores: plano de todos los precios efectivos disponibles
    const preciosCompetencia: number[] = []
    for (const pc of (preciosCompRaw as any[] | null) ?? []) {
      preciosCompetencia.push(+(pc.precio_oferta ?? pc.precio_normal))
    }

    if (preciosCompetencia.length === 0) {
      return NextResponse.json({ recomendaciones: [], total: 0 })
    }

    const mercadoMin  = Math.min(...preciosCompetencia)
    const mercadoMax  = Math.max(...preciosCompetencia)
    const mercadoProm = +(preciosCompetencia.reduce((s, n) => s + n, 0) / preciosCompetencia.length).toFixed(2)

    // ── 5. Generar recomendación por producto propio ──────────────
    const recomendaciones: {
      producto_id:            number
      nombre:                 string
      imagen_url:             string | null
      precio_propio_actual:   number
      precio_mercado_min:     number
      precio_mercado_promedio: number
      precio_mercado_max:     number
      recomendacion:          string
      accion:                 'bajar' | 'subir' | 'mantener'
      prioridad:              'alta' | 'media' | 'baja'
      impacto_estimado:       string
    }[] = []

    for (const prod of prodPropios) {
      const preciosArray = precioPorProducto.get(prod.id)
      if (!preciosArray || preciosArray.length === 0) continue

      const precioPropio = +(preciosArray.reduce((s, n) => s + n, 0) / preciosArray.length).toFixed(2)

      // Reglas de recomendación
      let recomendacion:    string
      let accion:           'bajar' | 'subir' | 'mantener'
      let prioridad:        'alta' | 'media' | 'baja'
      let impactoEstimado:  string

      const gapVsMin  = (precioPropio - mercadoMin)  / mercadoMin  * 100
      const gapVsProm = (precioPropio - mercadoProm) / mercadoProm * 100

      if (precioPropio > mercadoMin * 1.15) {
        // Estamos al menos 15% sobre el mínimo del mercado
        const pct = +gapVsMin.toFixed(0)
        accion           = 'bajar'
        recomendacion    = `Considera bajar precio — estás ${pct}% sobre el mínimo del mercado ($${mercadoMin.toFixed(2)})`
        prioridad        = pct >= 30 ? 'alta' : pct >= 15 ? 'media' : 'baja'
        impactoEstimado  = `Recuperar hasta ${Math.min(pct, 30)}% de share de mercado`
      } else if (precioPropio < mercadoMin) {
        // Por debajo del mínimo → podemos subir sin perder competitividad
        const margen = +(mercadoMin - precioPropio).toFixed(2)
        accion           = 'subir'
        recomendacion    = `Precio competitivo — podrías subir hasta $${mercadoMin.toFixed(2)} sin perder ventaja (ganancia $${margen} por unidad)`
        prioridad        = margen > 2 ? 'alta' : margen > 0.5 ? 'media' : 'baja'
        impactoEstimado  = `Incrementar margen estimado: $${margen} por unidad`
      } else {
        // En rango ±15% del mínimo y ≥ mínimo → alineado
        const absPctProm = Math.abs(gapVsProm)
        accion           = 'mantener'
        recomendacion    = absPctProm <= 5
          ? 'Precio alineado con el promedio del mercado — buena posición'
          : `Precio dentro del rango del mercado (${gapVsProm > 0 ? '+' : ''}${gapVsProm.toFixed(0)}% vs promedio)`
        prioridad        = 'baja'
        impactoEstimado  = 'Mantener posición actual en el mercado'
      }

      recomendaciones.push({
        producto_id:             prod.id,
        nombre:                  prod.nombre,
        imagen_url:              prod.imagen_url ?? null,
        precio_propio_actual:    precioPropio,
        precio_mercado_min:      +mercadoMin.toFixed(2),
        precio_mercado_promedio: mercadoProm,
        precio_mercado_max:      +mercadoMax.toFixed(2),
        recomendacion,
        accion,
        prioridad,
        impacto_estimado:        impactoEstimado,
      })
    }

    // Ordenar: alta → media → baja, luego por magnitud de gap
    const prioridadOrd = { alta: 0, media: 1, baja: 2 }
    recomendaciones.sort((a, b) => prioridadOrd[a.prioridad] - prioridadOrd[b.prioridad])

    return NextResponse.json({ recomendaciones, total: recomendaciones.length })
  } catch (err) {
    console.error('[proveedores/recomendaciones]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

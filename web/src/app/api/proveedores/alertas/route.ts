/**
 * GET /api/proveedores/alertas
 * Detecta cuando un competidor lanza una oferta:
 *   - Ofertas activas de marcas competidoras (precios_actuales, en_oferta = true)
 *   - Para cada una, busca la primera aparición de en_oferta=true en los últimos 7 días
 *     → si <= 48 h: "nueva", <= 96 h: "reciente", else: "vigente"
 *
 * Contexto histórico por marca competidora (últimos 90 días):
 *   - frecuencia_promos: frecuente (≥20 días con oferta) | moderada (5-19) | ocasional (<5)
 *   - dias_promo_ultimo_90d: días distintos con en_oferta=true
 *   - duracion_promedio_dias: duración media de ofertas anteriores (períodos cerrados)
 *   - productos_propios_afectados: cuántos productos propios compiten en la misma categoría
 *
 * NOTE: precios_actuales is a materialized view — PostgREST cannot infer FK relationships
 * from it. All joins are resolved manually to avoid silent query failures.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const db = createServiceClient()

    const { data: pRaw } = await db
      .from('proveedores')
      .select('id,marcas,competidores')
      .limit(1)
      .single()
    const prov = pRaw as any
    if (!prov) return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 })

    const marcasPropias: string[] = prov.marcas ?? []
    const competidores: string[]  = prov.competidores ?? []

    if (competidores.length === 0) {
      return NextResponse.json({ alertas: [], total_ofertas: 0, tiene_competidores: false })
    }

    // ── 1. Productos de las marcas competidoras ───────────────────
    const { data: prodCompRaw } = await db
      .from('productos')
      .select('id, nombre_normalizado, marca, imagen_url, activo, categoria_id')
      .in('marca', competidores)
      .eq('activo', true)

    const prodComp = (prodCompRaw as any[] | null) ?? []
    if (prodComp.length === 0) {
      return NextResponse.json({ alertas: [], total_ofertas: 0, tiene_competidores: true })
    }

    const prodCompMap = new Map<number, {
      nombre: string; marca: string; imagen_url: string | null; categoria_id: number | null
    }>(
      prodComp.map((p: any) => [p.id, {
        nombre:       p.nombre_normalizado,
        marca:        p.marca,
        imagen_url:   p.imagen_url ?? null,
        categoria_id: p.categoria_id ?? null,
      }])
    )
    const compProdIds = prodComp.map((p: any) => p.id)

    // ── 2. Variantes activas de esos productos ────────────────────
    const { data: varCompRaw } = await db
      .from('producto_variantes')
      .select('id, producto_id')
      .in('producto_id', compProdIds)
      .eq('activo', true)

    const varComp = (varCompRaw as any[] | null) ?? []
    if (varComp.length === 0) {
      return NextResponse.json({ alertas: [], total_ofertas: 0, tiene_competidores: true })
    }

    const varProdMap = new Map<number, number>(
      varComp.map((v: any) => [v.id, v.producto_id])
    )
    const compVarIds = varComp.map((v: any) => v.id)

    // ── 3. Ofertas activas de esos variantes ──────────────────────
    const { data: ofertasRaw } = await db
      .from('precios_actuales')
      .select('variante_id, supermercado_id, precio_normal, precio_oferta, en_oferta, descuento_pct')
      .in('variante_id', compVarIds)
      .eq('en_oferta', true)
      .order('descuento_pct', { ascending: false })

    const filas = (ofertasRaw as any[] | null) ?? []
    if (filas.length === 0) {
      return NextResponse.json({ alertas: [], total_ofertas: 0, tiene_competidores: true })
    }

    // ── 4. Supermercados (para nombre y color) ────────────────────
    const superIdsNeeded = [...new Set(filas.map((f: any) => f.supermercado_id))]
    const { data: superRaw } = await db
      .from('supermercados')
      .select('id, nombre, nombre_corto, color_hex')
      .in('id', superIdsNeeded)

    const superMap = new Map<number, { nombre: string; key: string; color: string }>(
      ((superRaw as any[] | null) ?? []).map((s: any) => [
        s.id, { nombre: s.nombre, key: s.nombre_corto, color: s.color_hex }
      ])
    )

    // ── 5. Categorías (para nombre legible en la alerta) ──────────
    const catIdsNeeded = [...new Set(
      prodComp.map((p: any) => p.categoria_id).filter(Boolean)
    )]
    const catNombreMap = new Map<number, string>()
    if (catIdsNeeded.length > 0) {
      const { data: catRaw } = await db
        .from('categorias')
        .select('id, nombre')
        .in('id', catIdsNeeded)
      for (const c of (catRaw as any[] | null) ?? []) {
        catNombreMap.set(c.id, c.nombre)
      }
    }

    // ── 6. Cuándo comenzó cada oferta ────────────────────────────
    const varianteIds = filas.map((f: any) => f.variante_id)
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

    // ── 7. Agrupar variante_ids y categorías por marca competidora ─
    const variantesPorMarca: Record<string, number[]>    = {}
    const categoriasPorMarca: Record<string, Set<number>> = {}

    for (const f of filas) {
      const prodId = varProdMap.get(f.variante_id)
      if (prodId === undefined) continue
      const prod = prodCompMap.get(prodId)
      if (!prod) continue

      const marca = prod.marca
      if (!variantesPorMarca[marca]) variantesPorMarca[marca] = []
      variantesPorMarca[marca].push(f.variante_id)

      const catId = prod.categoria_id
      if (catId) {
        if (!categoriasPorMarca[marca]) categoriasPorMarca[marca] = new Set()
        categoriasPorMarca[marca].add(catId)
      }
    }

    // ── 8. Historial de 90 días para variantes de marcas competidoras ─
    const hace90dias = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

    const { data: hist90Raw } = await db
      .from('precios')
      .select('variante_id, fecha_hora, en_oferta')
      .in('variante_id', varianteIds)
      .gte('fecha_hora', hace90dias)
      .order('variante_id', { ascending: true })
      .order('fecha_hora', { ascending: true })

    const hist90 = (hist90Raw as any[] | null) ?? []

    // ── 8a. Días distintos con en_oferta=true por variante ────────
    const diasOfertaPorVariante: Record<number, Set<string>> = {}
    for (const r of hist90) {
      if (!r.en_oferta) continue
      const dia = r.fecha_hora.slice(0, 10)
      if (!diasOfertaPorVariante[r.variante_id]) diasOfertaPorVariante[r.variante_id] = new Set()
      diasOfertaPorVariante[r.variante_id].add(dia)
    }

    // ── 8b. Duración promedio de ofertas anteriores ───────────────
    const registrosPorVariante: Record<number, { fecha_hora: string; en_oferta: boolean }[]> = {}
    for (const r of hist90) {
      if (!registrosPorVariante[r.variante_id]) registrosPorVariante[r.variante_id] = []
      registrosPorVariante[r.variante_id].push({ fecha_hora: r.fecha_hora, en_oferta: r.en_oferta })
    }

    const duracionesTotalPorVariante: Record<number, { totalDias: number; rachas: number }> = {}
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)

    for (const [vidStr, registros] of Object.entries(registrosPorVariante)) {
      const vid = Number(vidStr)
      let rachaInicio: Date | null = null
      let totalDias = 0
      let rachas = 0

      for (const r of registros) {
        const fecha = new Date(r.fecha_hora)
        if (r.en_oferta && rachaInicio === null) {
          rachaInicio = fecha
        } else if (!r.en_oferta && rachaInicio !== null) {
          const durDias = Math.max(1, Math.round((fecha.getTime() - rachaInicio.getTime()) / 86_400_000))
          totalDias += durDias
          rachas++
          rachaInicio = null
        }
      }

      if (rachas > 0) {
        duracionesTotalPorVariante[vid] = { totalDias, rachas }
      }
    }

    // ── 9. Productos propios afectados por categoría ──────────────
    let productosPropiosPorCategoria: Record<number, number> = {}

    if (marcasPropias.length > 0) {
      const { data: propiosRaw } = await db
        .from('productos')
        .select('categoria_id')
        .in('marca', marcasPropias)
        .eq('activo', true)
        .not('categoria_id', 'is', null)

      for (const p of (propiosRaw as any[] | null) ?? []) {
        const cid: number = p.categoria_id
        productosPropiosPorCategoria[cid] = (productosPropiosPorCategoria[cid] ?? 0) + 1
      }
    }

    // ── 10. Calcular métricas históricas por marca ─────────────────
    type MetricasMarca = {
      frecuencia_promos:           'frecuente' | 'moderada' | 'ocasional'
      dias_promo_ultimo_90d:       number
      duracion_promedio_dias:      number | null
      productos_propios_afectados: number
    }

    const metricasPorMarca: Record<string, MetricasMarca> = {}

    for (const marca of competidores) {
      const vids = variantesPorMarca[marca] ?? []
      if (vids.length === 0) continue

      const diasUnion = new Set<string>()
      for (const vid of vids) {
        for (const dia of diasOfertaPorVariante[vid] ?? []) diasUnion.add(dia)
      }
      const diasPromo = diasUnion.size

      const frecuencia: 'frecuente' | 'moderada' | 'ocasional' =
        diasPromo >= 20 ? 'frecuente' :
        diasPromo >= 5  ? 'moderada'  :
        'ocasional'

      let totalDiasRachas = 0
      let totalRachas = 0
      for (const vid of vids) {
        const d = duracionesTotalPorVariante[vid]
        if (d) { totalDiasRachas += d.totalDias; totalRachas += d.rachas }
      }
      const duracionPromedio = totalRachas > 0 ? Math.round(totalDiasRachas / totalRachas) : null

      let afectados = 0
      for (const catId of categoriasPorMarca[marca] ?? []) {
        afectados += productosPropiosPorCategoria[catId] ?? 0
      }

      metricasPorMarca[marca] = {
        frecuencia_promos:          frecuencia,
        dias_promo_ultimo_90d:      diasPromo,
        duracion_promedio_dias:     duracionPromedio,
        productos_propios_afectados: afectados,
      }
    }

    // ── 11. Agrupar por marca, calcular antigüedad ─────────────────
    type Alerta = {
      marca:                       string
      total:                       number
      frecuencia_promos:           'frecuente' | 'moderada' | 'ocasional'
      dias_promo_ultimo_90d:       number
      duracion_promedio_dias:      number | null
      productos_propios_afectados: number
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
      const prodId = varProdMap.get(f.variante_id)
      if (prodId === undefined) continue
      const prod = prodCompMap.get(prodId)
      if (!prod) continue

      const marca = prod.marca
      const super_ = superMap.get(f.supermercado_id)
      const catNombre = prod.categoria_id ? catNombreMap.get(prod.categoria_id) ?? null : null

      if (!porMarca[marca]) {
        const m = metricasPorMarca[marca] ?? {
          frecuencia_promos:           'ocasional' as const,
          dias_promo_ultimo_90d:       0,
          duracion_promedio_dias:      null,
          productos_propios_afectados: 0,
        }
        porMarca[marca] = { marca, total: 0, ofertas: [], ...m }
      }

      const inicio      = inicioOferta.get(f.variante_id) ?? null
      const horasActiva = inicio
        ? Math.round((Date.now() - new Date(inicio).getTime()) / 3_600_000)
        : null

      const estadoOferta: 'nueva' | 'reciente' | 'vigente' =
        horasActiva !== null && horasActiva <= 48 ? 'nueva'    :
        horasActiva !== null && horasActiva <= 96 ? 'reciente' :
        'vigente'

      porMarca[marca].total++
      porMarca[marca].ofertas.push({
        producto_id:   prodId,
        variante_id:   f.variante_id,
        nombre:        prod.nombre,
        imagen_url:    prod.imagen_url,
        categoria:     catNombre,
        supermercado:  super_?.nombre  ?? '—',
        key:           super_?.key     ?? '',
        color:         super_?.color   ?? '#94a3b8',
        precio_normal: +f.precio_normal,
        precio_oferta: f.precio_oferta != null ? +f.precio_oferta : null,
        descuento_pct: f.descuento_pct != null ? +f.descuento_pct : null,
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

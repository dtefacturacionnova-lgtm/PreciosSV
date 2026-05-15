/**
 * GET /api/proveedores/exportar?tipo=cumplimiento|alertas|tendencias&formato=csv&dias=30
 * Exporta datos del dashboard de proveedores en formato CSV.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const UMBRAL_PCT = 5

// ─── Helpers CSV ──────────────────────────────────────────────────────────────

function escaparCampo(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return ''
  const str = String(valor)
  // Escapar campos que contengan comas, comillas o saltos de línea
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function filaCSV(campos: (string | number | null | undefined)[]): string {
  return campos.map(escaparCampo).join(',')
}

function fechaHoy(): string {
  return new Date().toISOString().split('T')[0]
}

// ─── Auth compartida ──────────────────────────────────────────────────────────

async function autenticarProveedor() {
  const db = createServiceClient()

  const { data: pRaw } = await db
    .from('proveedores')
    .select('id,marcas,competidores')
    .limit(1)
    .single()
  const prov = pRaw as any
  if (!prov) return { error: 'Proveedor no encontrado', status: 404, prov: null, db: null }

  return { error: null, status: 200, prov, db }
}

function csvResponse(contenido: string, tipo: string): Response {
  const bom = '﻿'
  const body = bom + contenido
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="preciosv_${tipo}_${fechaHoy()}.csv"`,
    },
  })
}

// ─── Exportar cumplimiento ────────────────────────────────────────────────────

async function exportarCumplimiento(prov: any, db: any): Promise<string> {
  const encabezado = filaCSV([
    'Producto', 'Marca', 'PVP Sugerido ($)', 'Supermercado',
    'Precio Actual ($)', 'Desviación%', 'Estado', 'Enlazado',
  ])

  // ── 1. Catálogo del proveedor con PVP sugerido ───────────────
  const { data: catalogoRaw } = await db
    .from('proveedor_catalogo')
    .select('id, nombre, marca, pvp_sugerido, producto_id')
    .eq('proveedor_id', prov.id)
    .eq('activo', true)
    .not('pvp_sugerido', 'is', null)
    .order('nombre')

  const catalogo = (catalogoRaw as any[] | null) ?? []
  if (catalogo.length === 0) return encabezado

  // ── 2. Precios actuales para productos enlazados ─────────────
  const productoIds = catalogo
    .filter((c: any) => c.producto_id != null)
    .map((c: any) => c.producto_id as number)

  const preciosPorProducto = new Map<number, any[]>()

  if (productoIds.length > 0) {
    const { data: prodRaw } = await db
      .from('productos')
      .select(`
        id,
        precios_actuales(
          precio_normal, precio_oferta, en_oferta,
          supermercados(nombre)
        )
      `)
      .in('id', productoIds)

    for (const prod of (prodRaw as any[] | null) ?? []) {
      preciosPorProducto.set(prod.id, prod.precios_actuales ?? [])
    }
  }

  // ── 3. Construir CSV ─────────────────────────────────────────
  const filas: string[] = [encabezado]

  for (const c of catalogo) {
    const pvp    = c.pvp_sugerido != null ? +c.pvp_sugerido : null
    const precios: any[] = preciosPorProducto.get(c.producto_id) ?? []
    const enlazado = !!c.producto_id

    if (precios.length === 0) {
      filas.push(filaCSV([
        c.nombre, c.marca,
        pvp != null ? pvp.toFixed(2) : '',
        '', '', '',
        enlazado ? 'sin_datos' : 'sin_enlace',
        enlazado ? 'Sí' : 'No',
      ]))
      continue
    }

    for (const p of precios) {
      const s = p.supermercados as any
      const precioEfectivo = +(p.precio_oferta ?? p.precio_normal)
      let desviacion_pct: number | null = null
      let estado = 'sin_datos'

      if (pvp !== null) {
        desviacion_pct = +((precioEfectivo - pvp) / pvp * 100).toFixed(1)
        estado = desviacion_pct > UMBRAL_PCT ? 'alto' : desviacion_pct < -UMBRAL_PCT ? 'bajo' : 'ok'
      }

      filas.push(filaCSV([
        c.nombre, c.marca,
        pvp != null ? pvp.toFixed(2) : '',
        s?.nombre ?? '—',
        precioEfectivo.toFixed(2),
        desviacion_pct !== null ? desviacion_pct.toFixed(1) : '',
        estado,
        'Sí',
      ]))
    }
  }

  return filas.join('\r\n')
}

// ─── Exportar tendencias ──────────────────────────────────────────────────────

async function exportarTendencias(prov: any, db: any, dias: number): Promise<string> {
  const marcasPropias: string[] = prov.marcas ?? []
  const competidores: string[]  = prov.competidores ?? []
  const todasLasMarcas = [...new Set([...marcasPropias, ...competidores])]

  const encabezado = filaCSV(['Fecha', 'Marca', 'Precio Promedio'])

  if (todasLasMarcas.length === 0) return encabezado

  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()

  const { data: prodRaw } = await db
    .from('productos')
    .select('id, marca')
    .in('marca', todasLasMarcas)
    .eq('activo', true)

  const productosData = (prodRaw as any[] | null) ?? []
  const productIds    = productosData.map((p: any) => p.id)
  const productoMarcaMap = new Map<number, string>(productosData.map((p: any) => [p.id, p.marca as string]))

  if (productIds.length === 0) return encabezado

  const { data: varRaw } = await db
    .from('producto_variantes')
    .select('id, producto_id')
    .in('producto_id', productIds)
    .eq('activo', true)

  const variantes       = (varRaw as any[] | null) ?? []
  const varianteIds     = variantes.map((v: any) => v.id)
  const varianteProdMap = new Map<number, number>(variantes.map((v: any) => [v.id, v.producto_id as number]))

  if (varianteIds.length === 0) return encabezado

  const { data: preciosRaw } = await db
    .from('precios')
    .select('variante_id, precio_normal, precio_oferta, fecha_hora')
    .in('variante_id', varianteIds)
    .gte('fecha_hora', desde)
    .order('fecha_hora', { ascending: true })

  const agregado: Record<string, Record<string, { sum: number; count: number }>> = {}

  for (const p of (preciosRaw as any[] | null) ?? []) {
    const productoId = varianteProdMap.get(p.variante_id as number)
    if (productoId === undefined) continue
    const marca = productoMarcaMap.get(productoId)
    if (!marca) continue

    const fecha          = (p.fecha_hora as string).split('T')[0]
    const precioEfectivo = +(p.precio_oferta ?? p.precio_normal)

    if (!agregado[marca])        agregado[marca] = {}
    if (!agregado[marca][fecha]) agregado[marca][fecha] = { sum: 0, count: 0 }
    agregado[marca][fecha].sum   += precioEfectivo
    agregado[marca][fecha].count += 1
  }

  const filas: string[] = [encabezado]

  const entradas: { fecha: string; marca: string; promedio: number }[] = []
  for (const [marca, diasData] of Object.entries(agregado)) {
    for (const [fecha, agg] of Object.entries(diasData)) {
      entradas.push({ fecha, marca, promedio: +(agg.sum / agg.count).toFixed(2) })
    }
  }
  entradas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.marca.localeCompare(b.marca))

  for (const e of entradas) {
    filas.push(filaCSV([e.fecha, e.marca, e.promedio.toFixed(2)]))
  }

  return filas.join('\r\n')
}

// ─── Exportar alertas ─────────────────────────────────────────────────────────

async function exportarAlertas(prov: any, db: any): Promise<string> {
  const competidores: string[] = prov.competidores ?? []

  const encabezado = filaCSV([
    'Marca Competidora', 'Producto', 'Supermercado',
    'Precio Normal', 'Precio Oferta', 'Descuento%',
    'Estado', 'Horas Activa',
  ])

  if (competidores.length === 0) return encabezado

  const { data: ofertasRaw } = await db
    .from('precios_actuales')
    .select(`
      variante_id,
      precio_normal, precio_oferta, en_oferta, descuento_pct,
      supermercados!inner(nombre),
      producto_variantes!inner(producto_id, activo),
      productos!inner(nombre_normalizado, marca, activo)
    `)
    .in('productos.marca', competidores)
    .eq('en_oferta', true)
    .eq('productos.activo', true)
    .eq('producto_variantes.activo', true)
    .order('descuento_pct', { ascending: false })

  const filas_raw = (ofertasRaw as any[] | null) ?? []
  if (filas_raw.length === 0) return encabezado

  const varianteIds = filas_raw.map((f: any) => f.variante_id)
  const hace7dias   = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: iniciosRaw } = await db
    .from('precios')
    .select('variante_id, fecha_hora')
    .in('variante_id', varianteIds)
    .eq('en_oferta', true)
    .gte('fecha_hora', hace7dias)
    .order('fecha_hora', { ascending: true })

  const inicioOferta = new Map<number, string>()
  for (const r of (iniciosRaw as any[] | null) ?? []) {
    if (!inicioOferta.has(r.variante_id)) inicioOferta.set(r.variante_id, r.fecha_hora)
  }

  const filas: string[] = [encabezado]

  for (const f of filas_raw) {
    const inicio      = inicioOferta.get(f.variante_id) ?? null
    const horasActiva = inicio
      ? Math.round((Date.now() - new Date(inicio).getTime()) / 3_600_000)
      : null

    const estado: string =
      horasActiva !== null && horasActiva <= 48 ? 'nueva'    :
      horasActiva !== null && horasActiva <= 96 ? 'reciente' :
      'vigente'

    filas.push(filaCSV([
      f.productos?.marca ?? '—',
      f.productos?.nombre_normalizado ?? '—',
      f.supermercados?.nombre ?? '—',
      (+f.precio_normal).toFixed(2),
      f.precio_oferta != null ? (+f.precio_oferta).toFixed(2) : '',
      f.descuento_pct != null ? (+f.descuento_pct).toFixed(1) : '',
      estado,
      horasActiva !== null ? String(horasActiva) : '',
    ]))
  }

  return filas.join('\r\n')
}

// ─── Handler principal ────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tipo    = searchParams.get('tipo') ?? ''
    const formato = searchParams.get('formato') ?? 'csv'
    const dias    = Math.min(parseInt(searchParams.get('dias') ?? '30'), 90)

    if (!['cumplimiento', 'alertas', 'tendencias'].includes(tipo)) {
      return NextResponse.json({ error: 'tipo inválido. Usa: cumplimiento, alertas o tendencias' }, { status: 400 })
    }
    if (formato !== 'csv') {
      return NextResponse.json({ error: 'formato inválido. Solo se admite csv' }, { status: 400 })
    }

    const { error, status, prov, db } = await autenticarProveedor()
    if (error || !prov || !db) {
      return NextResponse.json({ error }, { status })
    }

    let contenidoCSV: string

    if (tipo === 'cumplimiento') {
      contenidoCSV = await exportarCumplimiento(prov, db)
    } else if (tipo === 'tendencias') {
      contenidoCSV = await exportarTendencias(prov, db, dias)
    } else {
      contenidoCSV = await exportarAlertas(prov, db)
    }

    return csvResponse(contenidoCSV, tipo)
  } catch (err) {
    console.error('[proveedores/exportar]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

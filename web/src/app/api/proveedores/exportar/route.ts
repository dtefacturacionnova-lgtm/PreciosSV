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
    .select('id')
    .limit(1)
    .single()
  const prov = pRaw as any
  if (!prov) return { error: 'Proveedor no encontrado', status: 404, prov: null, db: null }

  return { error: null, status: 200, prov, db }
}

function csvResponse(contenido: string, tipo: string): Response {
  const bom  = '﻿'
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
  // Manual joins — precios_actuales is a materialized view; PostgREST cannot infer FKs.
  const productoIds = catalogo
    .filter((c: any) => c.producto_id != null)
    .map((c: any) => c.producto_id as number)

  type FilaPrecios = { supNombre: string; precio_normal: number; precio_oferta: number | null }
  const preciosPorProducto = new Map<number, FilaPrecios[]>()

  if (productoIds.length > 0) {
    const { data: varRaw } = await db
      .from('producto_variantes')
      .select('id, producto_id')
      .in('producto_id', productoIds)
      .eq('activo', true)

    const variantes  = (varRaw as any[] | null) ?? []
    const varProdMap = new Map<number, number>(variantes.map((v: any) => [v.id, v.producto_id]))
    const varIds     = variantes.map((v: any) => v.id)

    if (varIds.length > 0) {
      const { data: paRaw } = await db
        .from('precios_actuales')
        .select('variante_id, supermercado_id, precio_normal, precio_oferta')
        .in('variante_id', varIds)

      const paData   = (paRaw as any[] | null) ?? []
      const superIds = [...new Set(paData.map((p: any) => p.supermercado_id))]
      const superNombreMap = new Map<number, string>()

      if (superIds.length > 0) {
        const { data: superRaw } = await db
          .from('supermercados').select('id, nombre').in('id', superIds)
        for (const s of (superRaw as any[] | null) ?? []) superNombreMap.set(s.id, s.nombre)
      }

      for (const pa of paData) {
        const prodId = varProdMap.get(pa.variante_id)
        if (prodId === undefined) continue
        if (!preciosPorProducto.has(prodId)) preciosPorProducto.set(prodId, [])
        preciosPorProducto.get(prodId)!.push({
          supNombre:     superNombreMap.get(pa.supermercado_id) ?? '—',
          precio_normal: +pa.precio_normal,
          precio_oferta: pa.precio_oferta != null ? +pa.precio_oferta : null,
        })
      }
    }
  }

  // ── 3. Construir CSV ─────────────────────────────────────────
  const filas: string[] = [encabezado]

  for (const c of catalogo) {
    const pvp      = c.pvp_sugerido != null ? +c.pvp_sugerido : null
    const precios  = preciosPorProducto.get(c.producto_id) ?? []
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
        p.supNombre,
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
  const encabezado = filaCSV(['Fecha', 'Producto', 'Tipo', 'Precio Promedio ($)'])
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()

  // ── 1. Catálogo propio con producto_id ───────────────────────
  const { data: catalogoRaw } = await (db as any)
    .from('proveedor_catalogo')
    .select('id, nombre, producto_id')
    .eq('proveedor_id', prov.id)
    .eq('activo', true)
    .not('producto_id', 'is', null)

  const catalogo    = (catalogoRaw as any[] | null) ?? []
  const catalogoIds = catalogo.map((c: any) => c.id as number)

  // Map: producto_id → label (catalog item nombre)
  const propiosMap = new Map<number, string>(
    catalogo.map((c: any) => [c.producto_id as number, c.nombre as string])
  )

  // ── 2. Competidores enlazados ────────────────────────────────
  const { data: compLinksRaw } = await (db as any)
    .from('proveedor_competidores_catalogo')
    .select('competidor_producto_id')
    .in('producto_id', catalogoIds.length > 0 ? catalogoIds : [-1])
    .eq('activo', true)
    .not('competidor_producto_id', 'is', null)

  const compProdIds = [...new Set(
    ((compLinksRaw as any[] | null) ?? []).map((c: any) => c.competidor_producto_id as number)
  )]

  const allProdIds = [...new Set([...propiosMap.keys(), ...compProdIds])]
  if (allProdIds.length === 0) return encabezado

  // ── 3. Nombres de productos competidores ─────────────────────
  const compNombreMap = new Map<number, string>()
  if (compProdIds.length > 0) {
    const { data: prodRaw } = await db
      .from('productos')
      .select('id, nombre_normalizado')
      .in('id', compProdIds)
      .eq('activo', true)
    for (const p of (prodRaw as any[] | null) ?? []) {
      compNombreMap.set(p.id, p.nombre_normalizado)
    }
  }

  // ── 4. Variantes ─────────────────────────────────────────────
  const { data: varRaw } = await db
    .from('producto_variantes')
    .select('id, producto_id')
    .in('producto_id', allProdIds)
    .eq('activo', true)

  const variantes       = (varRaw as any[] | null) ?? []
  const varianteIds     = variantes.map((v: any) => v.id)
  const varianteProdMap = new Map<number, number>(variantes.map((v: any) => [v.id, v.producto_id as number]))

  if (varianteIds.length === 0) return encabezado

  // ── 5. Precios históricos ────────────────────────────────────
  const { data: preciosRaw } = await db
    .from('precios')
    .select('variante_id, precio_normal, precio_oferta, fecha_hora')
    .in('variante_id', varianteIds)
    .gte('fecha_hora', desde)
    .order('fecha_hora', { ascending: true })

  // Agregado: key = `nombre||tipo||fecha`
  const agregado = new Map<string, { nombre: string; tipo: string; fecha: string; sum: number; count: number }>()

  for (const p of (preciosRaw as any[] | null) ?? []) {
    const prodId = varianteProdMap.get(p.variante_id as number)
    if (prodId === undefined) continue

    const esPropio = propiosMap.has(prodId)
    const nombre   = esPropio ? (propiosMap.get(prodId) ?? '—') : (compNombreMap.get(prodId) ?? '—')
    const tipo     = esPropio ? 'Propio' : 'Competidor'
    const fecha    = (p.fecha_hora as string).split('T')[0]
    const precio   = +(p.precio_oferta ?? p.precio_normal)

    const key = `${nombre}||${tipo}||${fecha}`
    if (!agregado.has(key)) agregado.set(key, { nombre, tipo, fecha, sum: 0, count: 0 })
    const agg  = agregado.get(key)!
    agg.sum   += precio
    agg.count += 1
  }

  const filas: string[] = [encabezado]
  const entradas = [...agregado.values()].map(e => ({
    fecha:    e.fecha,
    nombre:   e.nombre,
    tipo:     e.tipo,
    promedio: +(e.sum / e.count).toFixed(2),
  }))
  entradas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.nombre.localeCompare(b.nombre))

  for (const e of entradas) {
    filas.push(filaCSV([e.fecha, e.nombre, e.tipo, e.promedio.toFixed(2)]))
  }

  return filas.join('\r\n')
}

// ─── Exportar alertas ─────────────────────────────────────────────────────────

async function exportarAlertas(prov: any, db: any): Promise<string> {
  const encabezado = filaCSV([
    'Producto Competidor', 'Marca', 'Supermercado',
    'Precio Normal ($)', 'Precio Oferta ($)', 'Descuento%',
    'Estado', 'Horas Activa',
  ])

  // ── 1. Catálogo propio ───────────────────────────────────────
  const { data: catalogoRaw } = await (db as any)
    .from('proveedor_catalogo')
    .select('id')
    .eq('proveedor_id', prov.id)
    .eq('activo', true)

  const catalogoIds = ((catalogoRaw as any[] | null) ?? []).map((c: any) => c.id as number)
  if (catalogoIds.length === 0) return encabezado

  // ── 2. Competidores enlazados ────────────────────────────────
  const { data: compLinksRaw } = await (db as any)
    .from('proveedor_competidores_catalogo')
    .select('competidor_producto_id')
    .in('producto_id', catalogoIds)
    .eq('activo', true)
    .not('competidor_producto_id', 'is', null)

  const compProdIds = [...new Set(
    ((compLinksRaw as any[] | null) ?? []).map((c: any) => c.competidor_producto_id as number)
  )]
  if (compProdIds.length === 0) return encabezado

  // ── 3. Productos competidores ────────────────────────────────
  // Manual joins — precios_actuales is a materialized view; PostgREST cannot infer FKs
  const { data: prodRaw } = await db
    .from('productos')
    .select('id, nombre_normalizado, marca')
    .in('id', compProdIds)
    .eq('activo', true)

  const prodComp = (prodRaw as any[] | null) ?? []
  if (prodComp.length === 0) return encabezado

  const prodInfoMap = new Map<number, { nombre: string; marca: string }>(
    prodComp.map((p: any) => [p.id, { nombre: p.nombre_normalizado, marca: p.marca }])
  )

  // ── 4. Variantes ─────────────────────────────────────────────
  const { data: varRaw } = await db
    .from('producto_variantes')
    .select('id, producto_id')
    .in('producto_id', compProdIds)
    .eq('activo', true)

  const varComp    = (varRaw as any[] | null) ?? []
  const varProdMap = new Map<number, number>(varComp.map((v: any) => [v.id, v.producto_id]))
  const compVarIds = varComp.map((v: any) => v.id)
  if (compVarIds.length === 0) return encabezado

  // ── 5. Precios actuales en oferta ────────────────────────────
  const { data: ofertasRaw } = await db
    .from('precios_actuales')
    .select('variante_id, supermercado_id, precio_normal, precio_oferta, descuento_pct')
    .in('variante_id', compVarIds)
    .eq('en_oferta', true)
    .order('descuento_pct', { ascending: false })

  const filas_raw = (ofertasRaw as any[] | null) ?? []
  if (filas_raw.length === 0) return encabezado

  // ── 6. Supermercados ─────────────────────────────────────────
  const superIdsNeeded = [...new Set(filas_raw.map((f: any) => f.supermercado_id))]
  const superMap = new Map<number, string>()
  if (superIdsNeeded.length > 0) {
    const { data: superRaw } = await db
      .from('supermercados')
      .select('id, nombre')
      .in('id', superIdsNeeded)
    for (const s of (superRaw as any[] | null) ?? []) superMap.set(s.id, s.nombre)
  }

  // ── 7. Inicio de ofertas (últimos 7 días) ────────────────────
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

  // ── 8. Construir CSV ─────────────────────────────────────────
  const filas: string[] = [encabezado]

  for (const f of filas_raw) {
    const prodId      = varProdMap.get(f.variante_id)
    const prod        = prodId !== undefined ? prodInfoMap.get(prodId) : undefined
    const super_      = superMap.get(f.supermercado_id) ?? '—'
    const inicio      = inicioOferta.get(f.variante_id) ?? null
    const horasActiva = inicio
      ? Math.round((Date.now() - new Date(inicio).getTime()) / 3_600_000)
      : null

    const estado: string =
      horasActiva !== null && horasActiva <= 48 ? 'nueva'    :
      horasActiva !== null && horasActiva <= 96 ? 'reciente' :
      'vigente'

    filas.push(filaCSV([
      prod?.nombre ?? '—',
      prod?.marca  ?? '—',
      super_,
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

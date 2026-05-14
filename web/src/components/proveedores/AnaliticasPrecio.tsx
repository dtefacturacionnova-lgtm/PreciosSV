'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  RefreshCw, AlertTriangle, BarChart2,
  TrendingUp, TrendingDown, Minus,
} from 'lucide-react'
import clsx from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CadenaDato {
  supermercado:            string
  color:                   string
  precio_promedio_propio:  number
  precio_promedio_mercado: number
  indice:                  number
}

interface GapProducto {
  nombre:         string
  precio_propio:  number
  precio_mercado: number
  diferencia_pct: number
  imagen_url:     string | null
}

interface AnaliticasData {
  indice_global:        number
  productos_por_encima: number
  productos_en_rango:   number
  productos_por_debajo: number
  por_cadena:           CadenaDato[]
  top_gaps:             GapProducto[]
  sin_datos:            boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function colorIndice(indice: number): string {
  if (indice > 5)  return 'text-red-600'
  if (indice < -5) return 'text-emerald-600'
  return 'text-slate-500'
}

function bgIndice(indice: number): string {
  if (indice > 5)  return 'bg-red-50 text-red-700 border-red-100'
  if (indice < -5) return 'bg-emerald-50 text-emerald-700 border-emerald-100'
  return 'bg-slate-50 text-slate-600 border-slate-100'
}

function IconIndice({ indice }: { indice: number }) {
  if (indice > 1)  return <TrendingUp  className="w-3.5 h-3.5" />
  if (indice < -1) return <TrendingDown className="w-3.5 h-3.5" />
  return <Minus className="w-3.5 h-3.5" />
}

function fmtIndice(v: number): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}

// ─── Tarjeta: índice global ───────────────────────────────────────────────────

function TarjetaIndiceGlobal({ indice }: { indice: number }) {
  const color  = colorIndice(indice)
  const etiqueta =
    indice > 5  ? 'más caro que el mercado' :
    indice < -5 ? 'más barato que el mercado' :
                  'en línea con el mercado'

  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-6 flex flex-col items-center justify-center gap-1 shadow-sm">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
        Índice global de precio
      </p>
      <p className={clsx('text-5xl font-extrabold tabular-nums leading-none', color)}>
        {fmtIndice(indice)}
      </p>
      <p className="text-xs text-slate-400 mt-1">vs. mercado · {etiqueta}</p>
    </div>
  )
}

// ─── Barra de distribución ───────────────────────────────────────────────────

function BarraDistribucion({
  encima, rango, debajo,
}: {
  encima: number; rango: number; debajo: number
}) {
  const total = encima + rango + debajo || 1
  const pctEncima = Math.round((encima / total) * 100)
  const pctRango  = Math.round((rango  / total) * 100)
  const pctDebajo = 100 - pctEncima - pctRango

  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
        Distribución de SKUs vs. mercado
      </p>

      {/* Barra segmentada */}
      <div className="flex rounded-full overflow-hidden h-4 mb-4 gap-px bg-slate-100">
        {pctEncima > 0 && (
          <div
            className="bg-red-400 transition-all duration-500"
            style={{ width: `${pctEncima}%` }}
            title={`${encima} SKUs más caros`}
          />
        )}
        {pctRango > 0 && (
          <div
            className="bg-emerald-400 transition-all duration-500"
            style={{ width: `${pctRango}%` }}
            title={`${rango} SKUs en rango`}
          />
        )}
        {pctDebajo > 0 && (
          <div
            className="bg-blue-400 transition-all duration-500"
            style={{ width: `${pctDebajo}%` }}
            title={`${debajo} SKUs más baratos`}
          />
        )}
      </div>

      {/* Leyenda */}
      <div className="flex gap-4 flex-wrap text-xs">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400 flex-shrink-0" />
          <span className="text-slate-600 font-medium">{encima}</span>
          <span className="text-slate-400">más caros (&gt;+5%)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 flex-shrink-0" />
          <span className="text-slate-600 font-medium">{rango}</span>
          <span className="text-slate-400">en rango (±5%)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-400 flex-shrink-0" />
          <span className="text-slate-600 font-medium">{debajo}</span>
          <span className="text-slate-400">más baratos (&lt;-5%)</span>
        </div>
      </div>
    </div>
  )
}

// ─── Tabla por cadena ─────────────────────────────────────────────────────────

function TablaCadenas({ cadenas }: { cadenas: CadenaDato[] }) {
  if (cadenas.length === 0) return null

  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        <BarChart2 className="w-4 h-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-700">Índice por supermercado</h3>
        <span className="text-xs text-slate-400 ml-auto">precio propio vs. promedio de mercado</span>
      </div>

      <div className="divide-y divide-slate-50">
        {cadenas.map(c => (
          <div key={c.supermercado} className="flex items-center gap-4 px-5 py-3">
            {/* Punto de color + nombre */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: c.color }}
              />
              <span className="text-sm text-slate-700 font-medium truncate">
                {c.supermercado}
              </span>
            </div>

            {/* Precios */}
            <div className="flex items-center gap-3 text-xs text-slate-400 flex-shrink-0">
              <span>
                <span className="text-slate-600 font-semibold">${c.precio_promedio_propio.toFixed(2)}</span>
                {' '}propio
              </span>
              <span className="text-slate-200">·</span>
              <span>
                <span className="text-slate-600 font-semibold">${c.precio_promedio_mercado.toFixed(2)}</span>
                {' '}mercado
              </span>
            </div>

            {/* Badge índice */}
            <span className={clsx(
              'inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full border flex-shrink-0',
              bgIndice(c.indice)
            )}>
              <IconIndice indice={c.indice} />
              {fmtIndice(c.indice)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Top 5 gaps ───────────────────────────────────────────────────────────────

function TopGaps({ gaps }: { gaps: GapProducto[] }) {
  if (gaps.length === 0) return null

  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        <TrendingUp className="w-4 h-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-700">Productos con mayor brecha de precio</h3>
        <span className="text-xs text-slate-400 ml-auto">top 5 gaps</span>
      </div>

      <div className="divide-y divide-slate-50">
        {gaps.map((g, i) => (
          <div key={`${g.nombre}-${i}`} className="flex items-center gap-3 px-5 py-3">
            {/* Imagen o placeholder */}
            <div className="w-9 h-9 rounded-xl bg-slate-100 flex-shrink-0 overflow-hidden">
              {g.imagen_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={g.imagen_url}
                  alt={g.nombre}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-300 text-xs font-bold">
                  {i + 1}
                </div>
              )}
            </div>

            {/* Nombre */}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-700 font-medium truncate capitalize">{g.nombre}</p>
              <p className="text-xs text-slate-400">
                propio <span className="font-semibold text-slate-600">${g.precio_propio.toFixed(2)}</span>
                {' · '}mercado <span className="font-semibold text-slate-600">${g.precio_mercado.toFixed(2)}</span>
              </p>
            </div>

            {/* Badge */}
            <span className={clsx(
              'inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full border flex-shrink-0',
              bgIndice(g.diferencia_pct)
            )}>
              <IconIndice indice={g.diferencia_pct} />
              {fmtIndice(g.diferencia_pct)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Estado vacío ─────────────────────────────────────────────────────────────

function EstadoSinDatos() {
  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-10 text-center">
      <BarChart2 className="w-8 h-8 text-slate-300 mx-auto mb-3" />
      <p className="text-slate-500 text-sm mb-1">Sin datos comparativos aún</p>
      <p className="text-xs text-slate-400 max-w-xs mx-auto">
        Configura al menos un competidor en la pestaña <strong>Comparativa</strong> y
        asegúrate de que tus marcas tengan precios registrados en la base de datos.
      </p>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function AnaliticasPrecio() {
  const [data,     setData]     = useState<AnaliticasData | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/proveedores/analiticas')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Error al cargar analíticas')
      const json: AnaliticasData = await res.json()
      setData(json)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
    // Auto-refresh cada 5 minutos
    const id = setInterval(cargar, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [cargar])

  // ── Estados ────────────────────────────────────────────────────
  if (cargando && !data) {
    return (
      <div className="flex items-center justify-center py-14 gap-2 text-slate-400">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span className="text-sm">Calculando analíticas de precio…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
        <p className="text-sm text-amber-700 mb-3">{error}</p>
        <button
          onClick={cargar}
          className="text-xs text-amber-800 underline"
        >
          Reintentar
        </button>
      </div>
    )
  }

  if (!data) return null

  if (data.sin_datos) {
    return <EstadoSinDatos />
  }

  return (
    <div className="space-y-5">

      {/* Header con botón actualizar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">
          Comparación de tus precios vs. promedio de competidores · datos en tiempo real
        </p>
        <button
          onClick={cargar}
          disabled={cargando}
          className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
        >
          <RefreshCw className={clsx('w-3 h-3', cargando && 'animate-spin')} />
          Actualizar
        </button>
      </div>

      {/* Fila superior: índice global + distribución */}
      <div className={clsx(
        'grid gap-4',
        data.por_cadena.length > 0 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'
      )}>
        <TarjetaIndiceGlobal indice={data.indice_global} />
        <BarraDistribucion
          encima={data.productos_por_encima}
          rango={data.productos_en_rango}
          debajo={data.productos_por_debajo}
        />
      </div>

      {/* Tabla por cadena */}
      {data.por_cadena.length > 0 && (
        <TablaCadenas cadenas={data.por_cadena} />
      )}

      {/* Top 5 gaps */}
      {data.top_gaps.length > 0 && (
        <TopGaps gaps={data.top_gaps} />
      )}

      <p className="text-xs text-center text-slate-400">
        Índice = (precio propio prom. / precio mercado prom. − 1) × 100 · positivo = más caro · negativo = más barato
      </p>
    </div>
  )
}

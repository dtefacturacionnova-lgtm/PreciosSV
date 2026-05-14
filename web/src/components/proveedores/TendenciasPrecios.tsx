'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { RefreshCw, TrendingDown, TrendingUp, Minus, AlertTriangle, LineChart } from 'lucide-react'
import HistoricoChart from '@/components/HistoricoChart'
import clsx from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PuntoHistorico {
  fecha:               string
  precio_efectivo:     number
  supermercado_nombre: string
  supermercado_key:    string
  supermercado_color:  string
}

interface MarcaMeta {
  key:      string
  nombre:   string
  color:    string
  es_propio: boolean
}

interface TendenciasData {
  historico: PuntoHistorico[]
  marcas:    MarcaMeta[]
  dias:      number
}

// ─── Cálculo de tendencia ─────────────────────────────────────────────────────

function calcularTendencia(historico: PuntoHistorico[], marca: string): {
  inicio: number | null
  fin:    number | null
  pct:    number | null
  dir:    'sube' | 'baja' | 'estable' | 'sin_datos'
} {
  const puntos = historico
    .filter(p => p.supermercado_key === marca)
    .sort((a, b) => a.fecha.localeCompare(b.fecha))

  if (puntos.length < 2) return { inicio: null, fin: null, pct: null, dir: 'sin_datos' }

  const inicio = puntos[0].precio_efectivo
  const fin    = puntos[puntos.length - 1].precio_efectivo
  const pct    = +((fin - inicio) / inicio * 100).toFixed(1)

  const dir = Math.abs(pct) < 1 ? 'estable' : pct > 0 ? 'sube' : 'baja'
  return { inicio, fin, pct, dir }
}

// ─── Tarjeta de resumen por marca ────────────────────────────────────────────

function TarjetaTendencia({
  meta,
  historico,
  seleccionada,
  onToggle,
}: {
  meta:        MarcaMeta
  historico:   PuntoHistorico[]
  seleccionada: boolean
  onToggle:    () => void
}) {
  const tendencia = useMemo(() => calcularTendencia(historico, meta.key), [historico, meta.key])

  const IconDir =
    tendencia.dir === 'sube'    ? TrendingUp   :
    tendencia.dir === 'baja'    ? TrendingDown :
    tendencia.dir === 'estable' ? Minus        :
    Minus

  const colorDir =
    tendencia.dir === 'sube'    ? 'text-red-600'     :
    tendencia.dir === 'baja'    ? 'text-emerald-600' :
    tendencia.dir === 'estable' ? 'text-slate-400'   :
    'text-slate-300'

  return (
    <button
      onClick={onToggle}
      className={clsx(
        'text-left border rounded-xl p-3 transition-all',
        seleccionada
          ? 'bg-white shadow-sm border-slate-200'
          : 'bg-slate-50 border-slate-100 opacity-60 hover:opacity-80'
      )}
    >
      {/* Indicador de color + nombre */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: meta.color }}
        />
        <span className="text-xs font-semibold text-slate-700 truncate">{meta.nombre}</span>
        {meta.es_propio && (
          <span className="text-xs text-blue-500 font-medium ml-auto flex-shrink-0">Tu marca</span>
        )}
      </div>

      {/* Precios y tendencia */}
      {tendencia.fin !== null ? (
        <div className="flex items-end justify-between gap-1">
          <div>
            <p className="text-lg font-bold text-slate-800">${tendencia.fin.toFixed(2)}</p>
            <p className="text-xs text-slate-400">precio actual prom.</p>
          </div>
          <div className={clsx('flex items-center gap-0.5 text-sm font-bold', colorDir)}>
            <IconDir className="w-4 h-4" />
            {tendencia.pct !== null && Math.abs(tendencia.pct) >= 1 && (
              <span>{tendencia.pct > 0 ? '+' : ''}{tendencia.pct}%</span>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-400 italic">Sin datos suficientes</p>
      )}
    </button>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function TendenciasPrecios() {
  const [data,          setData]          = useState<TendenciasData | null>(null)
  const [cargando,      setCargando]      = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [dias,          setDias]          = useState(30)
  const [marcasActivas, setMarcasActivas] = useState<Set<string>>(new Set())

  const cargar = useCallback(async (d: number) => {
    setCargando(true)
    setError(null)
    try {
      const res = await fetch(`/api/proveedores/tendencias?dias=${d}`)
      if (!res.ok) throw new Error((await res.json()).error ?? 'Error')
      const d2: TendenciasData = await res.json()
      setData(d2)
      // Primera carga → seleccionar todas las marcas
      setMarcasActivas(prev =>
        prev.size === 0 ? new Set(d2.marcas.map(m => m.key)) : prev
      )
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar(dias) }, [cargar, dias])

  function toggleMarca(key: string) {
    setMarcasActivas(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        // No dejar vacío
        if (next.size <= 1) return prev
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  // Filtrar historico por marcas activas
  const historicoFiltrado = useMemo(
    () => (data?.historico ?? []).filter(p => marcasActivas.has(p.supermercado_key)),
    [data?.historico, marcasActivas]
  )

  // ── Estados ────────────────────────────────────────────────────
  if (cargando && !data) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span className="text-sm">Cargando tendencias…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
        <p className="text-sm text-amber-700 mb-3">{error}</p>
        <button onClick={() => cargar(dias)} className="text-xs text-amber-800 underline">Reintentar</button>
      </div>
    )
  }

  if (!data) return null

  if (data.marcas.length === 0) {
    return (
      <div className="bg-white border border-slate-100 rounded-2xl p-8 text-center">
        <LineChart className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-slate-500 text-sm mb-1">Sin datos de tendencias</p>
        <p className="text-xs text-slate-400">
          Configura competidores y espera a que el sistema acumule datos de precios.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* Controles */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Selector de días */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDias(d)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                dias === d
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              )}
            >
              {d}d
            </button>
          ))}
        </div>

        <button
          onClick={() => cargar(dias)}
          disabled={cargando}
          className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
        >
          <RefreshCw className={clsx('w-3 h-3', cargando && 'animate-spin')} />
          Actualizar
        </button>
      </div>

      {/* Tarjetas resumen por marca */}
      <div className={clsx(
        'grid gap-3',
        data.marcas.length <= 2 ? 'grid-cols-2' :
        data.marcas.length <= 4 ? 'grid-cols-2 md:grid-cols-4' :
        'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
      )}>
        {data.marcas.map(meta => (
          <TarjetaTendencia
            key={meta.key}
            meta={meta}
            historico={data.historico}
            seleccionada={marcasActivas.has(meta.key)}
            onToggle={() => toggleMarca(meta.key)}
          />
        ))}
      </div>

      {/* Gráfica principal */}
      <div className={clsx(cargando && 'opacity-60 pointer-events-none', 'transition-opacity')}>
        <HistoricoChart historico={historicoFiltrado} dias={dias} />
      </div>

      {/* Análisis textual */}
      {data.historico.length > 0 && (
        <div className="bg-white border border-slate-100 rounded-2xl p-4">
          <h4 className="text-sm font-semibold text-slate-700 mb-3">
            Resumen del período ({dias} días)
          </h4>
          <div className="grid gap-2">
            {data.marcas.map(meta => {
              const t = calcularTendencia(data.historico, meta.key)
              if (t.dir === 'sin_datos') return null

              const EsPropio = meta.es_propio
              const IconDir  = t.dir === 'sube' ? TrendingUp : t.dir === 'baja' ? TrendingDown : Minus
              const colorDir = t.dir === 'sube' ? 'text-red-600' : t.dir === 'baja' ? 'text-emerald-600' : 'text-slate-400'
              const texto    =
                t.dir === 'baja'    ? `bajó ${Math.abs(t.pct!)}% → oportunidad para destacar tu precio`     :
                t.dir === 'sube'    ? `subió ${t.pct}% → mercado más caro, posible ventaja de precio`         :
                                      `precio estable en el período`

              return (
                <div key={meta.key} className="flex items-start gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: meta.color }} />
                  <div className="flex-1">
                    <span className={clsx('font-semibold', EsPropio ? 'text-blue-800' : 'text-slate-700')}>
                      {meta.nombre}
                    </span>
                    {EsPropio && <span className="text-xs text-blue-400 ml-1">(tu marca)</span>}
                    {' '}
                    <span className="text-slate-500">{texto}</span>
                  </div>
                  <div className={clsx('flex items-center gap-0.5 font-bold flex-shrink-0', colorDir)}>
                    <IconDir className="w-3.5 h-3.5" />
                    {t.pct !== null && <span className="text-xs">{t.pct > 0 ? '+' : ''}{t.pct}%</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <p className="text-xs text-center text-slate-400">
        Precio promedio efectivo (oferta o normal) · Agrupado por día · Todas las cadenas incluidas
      </p>
    </div>
  )
}

'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  RefreshCw, TrendingUp, TrendingDown, Package,
  AlertTriangle, Clock, Download,
} from 'lucide-react'
import clsx from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoAnomalia = 'subida_brusca' | 'bajada_brusca'

interface Anomalia {
  variante_id:     number
  nombre:          string
  supermercado:    string
  color:           string
  marca:           string
  es_propio:       boolean
  precio_anterior: number
  precio_actual:   number
  cambio_pct:      number
  tipo:            TipoAnomalia
  detectado_en:    string
}

interface AnomaliasData {
  anomalias:    Anomalia[]
  total:        number
  sin_historial?: boolean
}

// ─── Tarjeta de anomalía ──────────────────────────────────────────────────────

function TarjetaAnomalia({ a }: { a: Anomalia }) {
  const esSubida = a.tipo === 'subida_brusca'
  const absPct   = Math.abs(a.cambio_pct)

  const urgencia: 'alta' | 'media' | 'baja' =
    absPct >= 30 ? 'alta' :
    absPct >= 15 ? 'media' :
    'baja'

  const urgenciaColor = {
    alta:  esSubida ? 'border-l-red-500'    : 'border-l-blue-500',
    media: esSubida ? 'border-l-amber-400'  : 'border-l-indigo-400',
    baja:  'border-l-slate-300',
  }[urgencia]

  return (
    <div className={clsx(
      'bg-white rounded-xl border border-slate-100 shadow-sm border-l-4 p-4',
      urgenciaColor
    )}>
      <div className="flex items-start justify-between gap-3">

        {/* Info principal */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {a.es_propio ? (
              <span className="text-[10px] bg-blue-100 text-blue-700 font-semibold px-1.5 py-0.5 rounded-full">Tu marca</span>
            ) : (
              <span className="text-[10px] bg-slate-100 text-slate-600 font-medium px-1.5 py-0.5 rounded-full">Competidor</span>
            )}
            <span className="text-[10px] text-slate-400 font-medium">{a.marca}</span>
          </div>
          <p className="text-sm font-semibold text-slate-800 leading-tight">{a.nombre}</p>

          {/* Tienda */}
          <div className="flex items-center gap-1.5 mt-1.5">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: a.color }}
            />
            <span className="text-xs text-slate-500">{a.supermercado}</span>
          </div>
        </div>

        {/* Precios + cambio */}
        <div className="flex-shrink-0 text-right">
          {/* Precio actual */}
          <p className={clsx(
            'text-lg font-bold',
            esSubida ? 'text-red-600' : 'text-blue-600'
          )}>
            ${a.precio_actual.toFixed(2)}
          </p>
          {/* Precio anterior tachado */}
          <p className="text-xs text-slate-400 line-through">${a.precio_anterior.toFixed(2)}</p>

          {/* Badge de cambio */}
          <div className={clsx(
            'inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full mt-1',
            esSubida
              ? 'bg-red-100 text-red-700'
              : 'bg-blue-100 text-blue-700'
          )}>
            {esSubida
              ? <TrendingUp   className="w-3 h-3" />
              : <TrendingDown className="w-3 h-3" />
            }
            {a.cambio_pct > 0 ? '+' : ''}{a.cambio_pct.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Pie: tiempo detectado */}
      <div className="flex items-center gap-1 mt-2 text-[10px] text-slate-400">
        <Clock className="w-2.5 h-2.5" />
        Detectado {new Date(a.detectado_en).toLocaleDateString('es-SV', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        })}
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function AnomaliasPrecios() {
  const [estado, setEstado] = useState<{
    cargando:     boolean
    error:        string | null
    data:         AnomaliasData | null
  }>({ cargando: true, error: null, data: null })

  const [filtro, setFiltro] = useState<'todos' | 'propios' | 'competidores'>('todos')
  const [cargandoExport, setCargandoExport] = useState(false)

  const cargar = useCallback(async () => {
    setEstado(s => ({ ...s, cargando: true, error: null }))
    try {
      const res = await fetch('/api/proveedores/anomalias')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Error')
      setEstado({ cargando: false, error: null, data: await res.json() })
    } catch (e: any) {
      setEstado({ cargando: false, error: e.message ?? 'Error', data: null })
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function descargar() {
    setCargandoExport(true)
    try {
      const res  = await fetch('/api/proveedores/exportar?tipo=tendencias&formato=csv&dias=14')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `preciosv_anomalias_${new Date().toISOString().split('T')[0]}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setCargandoExport(false)
    }
  }

  // ── Estados ──────────────────────────────────────────────────────
  if (estado.cargando) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span className="text-sm">Analizando variaciones de precio…</span>
      </div>
    )
  }

  if (estado.error) {
    return (
      <div className="bg-red-50 border border-red-100 rounded-2xl p-6 text-center max-w-md mx-auto mt-4">
        <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-600">{estado.error}</p>
        <button onClick={cargar} className="mt-3 text-xs text-red-700 underline">Reintentar</button>
      </div>
    )
  }

  const d = estado.data!

  if (d.sin_historial) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center max-w-md mx-auto mt-4">
        <Package className="w-9 h-9 text-slate-200 mx-auto mb-3" />
        <h3 className="text-sm font-semibold text-slate-600 mb-1">Sin historial de precios suficiente</h3>
        <p className="text-xs text-slate-400">
          Las anomalías se detectan cuando hay al menos 3 lecturas de precio en los últimos 7 días
          de baseline. Aparecerán automáticamente conforme los scrapers acumulen datos.
        </p>
      </div>
    )
  }

  const anomalias = d.anomalias.filter(a => {
    if (filtro === 'propios')      return a.es_propio
    if (filtro === 'competidores') return !a.es_propio
    return true
  })

  const nSubidas = anomalias.filter(a => a.tipo === 'subida_brusca').length
  const nBajadas = anomalias.filter(a => a.tipo === 'bajada_brusca').length

  return (
    <div className="space-y-5">

      {/* Encabezado + controles */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-700">
            Anomalías de precio — últimos 7 días
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            Cambios &gt; 15% o &gt; 2σ respecto a la semana anterior
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={descargar}
            disabled={cargandoExport || d.total === 0}
            className="inline-flex items-center gap-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
          >
            {cargandoExport
              ? <RefreshCw className="w-3 h-3 animate-spin" />
              : <Download className="w-3 h-3" />
            }
            Exportar CSV
          </button>
          <button
            onClick={cargar}
            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Actualizar
          </button>
        </div>
      </div>

      {/* Resumen rápido */}
      {d.total > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Subidas bruscas',  val: nSubidas,  color: 'text-red-600',  bg: 'bg-red-50',   icon: TrendingUp   },
            { label: 'Bajadas bruscas',  val: nBajadas,  color: 'text-blue-600', bg: 'bg-blue-50',  icon: TrendingDown },
            { label: 'Total anomalías',  val: d.total,   color: 'text-slate-800',bg: 'bg-slate-50', icon: AlertTriangle },
          ].map(({ label, val, color, bg, icon: Icono }) => (
            <div key={label} className={clsx('rounded-xl p-4 text-center', bg)}>
              <Icono className={clsx('w-4 h-4 mx-auto mb-1 opacity-70', color)} />
              <p className={clsx('text-2xl font-bold', color)}>{val}</p>
              <p className="text-xs text-slate-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filtros */}
      {d.total > 0 && (
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 self-start w-fit">
          {([
            { id: 'todos',        label: `Todos (${d.total})` },
            { id: 'propios',      label: `Mis marcas (${d.anomalias.filter(a =>  a.es_propio).length})` },
            { id: 'competidores', label: `Competidores (${d.anomalias.filter(a => !a.es_propio).length})` },
          ] as { id: typeof filtro; label: string }[]).map(f => (
            <button
              key={f.id}
              onClick={() => setFiltro(f.id)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                filtro === f.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Lista de anomalías */}
      {d.total === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
          <div className="w-10 h-10 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <AlertTriangle className="w-5 h-5 text-emerald-500" />
          </div>
          <h3 className="text-sm font-semibold text-slate-700 mb-1">Sin anomalías detectadas</h3>
          <p className="text-xs text-slate-400">
            Los precios de tus marcas y competidores se han mantenido estables en los últimos 7 días.
          </p>
        </div>
      ) : anomalias.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center">
          <p className="text-sm text-slate-400">Sin anomalías para este filtro.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {anomalias.map(a => (
            <TarjetaAnomalia key={a.variante_id} a={a} />
          ))}
        </div>
      )}

      {/* Nota metodológica */}
      {d.total > 0 && (
        <p className="text-[10px] text-slate-400 text-right">
          Comparación: promedio de los últimos 7 días vs. los 7 días previos (baseline mínimo: 3 lecturas).
        </p>
      )}

    </div>
  )
}

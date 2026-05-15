'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  RefreshCw, AlertTriangle, ShieldAlert, ShieldCheck,
  TrendingDown, TrendingUp, Minus, Zap, Target,
  Package, BarChart3, Link2,
} from 'lucide-react'
import clsx from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

type NivelRiesgo = 'alto' | 'medio' | 'bajo' | 'ventaja' | 'sin_datos'

interface Resumen {
  total_catalogo:   number
  total_enlazados:  number
  cobertura_pct:    number
  con_competidores: number
  competidores_pct: number
  riesgo_alto:      number
  riesgo_medio:     number
  riesgo_bajo:      number
  ventaja:          number
  sin_datos:        number
  alertas_dumping:  number
}

interface ProductoRiesgo {
  catalogo_id:        number
  nombre:             string
  marca:              string | null
  imagen_url:         string | null
  categoria:          string | null
  subcategoria:       string | null
  pvp_sugerido:       number | null
  precio_propio_avg:  number | null
  precio_mercado_avg: number | null
  precio_mercado_min: number | null
  gap_pct:            number | null
  riesgo:             NivelRiesgo
  n_competidores:     number
  n_tiendas_propias:  number
}

interface AlertaDumping {
  catalogo_id:        number
  nombre_propio:      string
  competidor_nombre:  string
  competidor_marca:   string
  precio_competidor:  number
  precio_mercado_avg: number
  pvp_sugerido:       number | null
  diferencia_pct:     number
  supermercados:      string[]
}

interface RiesgoData {
  resumen:   Resumen
  productos: ProductoRiesgo[]
  dumping:   AlertaDumping[]
  sin_datos: boolean
}

// ─── Helpers de estilo ────────────────────────────────────────────────────────

const RIESGO_CONFIG: Record<NivelRiesgo, {
  label: string; bg: string; text: string; border: string; dot: string; icon: typeof ShieldAlert
}> = {
  alto:     { label: 'Alto',    bg: 'bg-red-50',      text: 'text-red-700',     border: 'border-red-200',    dot: 'bg-red-500',     icon: ShieldAlert  },
  medio:    { label: 'Medio',   bg: 'bg-amber-50',    text: 'text-amber-700',   border: 'border-amber-200',  dot: 'bg-amber-500',   icon: AlertTriangle },
  bajo:     { label: 'Bajo',    bg: 'bg-slate-50',    text: 'text-slate-600',   border: 'border-slate-200',  dot: 'bg-slate-400',   icon: Minus        },
  ventaja:  { label: 'Ventaja', bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200',dot: 'bg-emerald-500', icon: ShieldCheck  },
  sin_datos:{ label: 'Sin datos',bg: 'bg-slate-50',   text: 'text-slate-400',   border: 'border-slate-100',  dot: 'bg-slate-300',   icon: Minus        },
}

function BadgeRiesgo({ riesgo }: { riesgo: NivelRiesgo }) {
  const cfg = RIESGO_CONFIG[riesgo]
  const Icono = cfg.icon
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border',
      cfg.bg, cfg.text, cfg.border
    )}>
      <Icono className="w-3 h-3" />
      {cfg.label}
    </span>
  )
}

function fmtGap(gap: number | null): string {
  if (gap === null) return '—'
  return `${gap > 0 ? '+' : ''}${gap.toFixed(1)}%`
}

function colorGap(gap: number | null): string {
  if (gap === null) return 'text-slate-400'
  if (gap > 15)  return 'text-red-600 font-bold'
  if (gap > 5)   return 'text-amber-600 font-semibold'
  if (gap < -5)  return 'text-emerald-600 font-semibold'
  return 'text-slate-600'
}

// ─── Cards de penetración de mercado ─────────────────────────────────────────

function PenetracionCards({ r }: { r: Resumen }) {
  const cards = [
    {
      label: 'Productos enlazados',
      valor: `${r.total_enlazados} / ${r.total_catalogo}`,
      pct:   r.cobertura_pct,
      sub:   `${r.cobertura_pct}% del catálogo`,
      icon:  Link2,
      color: 'blue' as const,
    },
    {
      label: 'Con competidores',
      valor: `${r.con_competidores} / ${r.total_catalogo}`,
      pct:   r.competidores_pct,
      sub:   `${r.competidores_pct}% mapeados`,
      icon:  BarChart3,
      color: 'violet' as const,
    },
    {
      label: 'Sin riesgo / ventaja',
      valor: `${r.riesgo_bajo + r.ventaja}`,
      pct:   r.total_catalogo > 0
        ? Math.round(((r.riesgo_bajo + r.ventaja) / r.total_catalogo) * 100)
        : 0,
      sub:   `${r.ventaja} con ventaja de precio`,
      icon:  ShieldCheck,
      color: 'emerald' as const,
    },
    {
      label: 'Riesgo alto / medio',
      valor: `${r.riesgo_alto + r.riesgo_medio}`,
      pct:   r.total_catalogo > 0
        ? Math.round(((r.riesgo_alto + r.riesgo_medio) / r.total_catalogo) * 100)
        : 0,
      sub:   `${r.riesgo_alto} de riesgo crítico`,
      icon:  ShieldAlert,
      color: r.riesgo_alto > 0 ? 'red' as const : 'amber' as const,
    },
  ]

  const COLOR_MAP: Record<string, { bg: string; text: string; bar: string }> = {
    blue:    { bg: 'bg-blue-50',    text: 'text-blue-700',    bar: 'bg-blue-500'    },
    violet:  { bg: 'bg-violet-50',  text: 'text-violet-700',  bar: 'bg-violet-500'  },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', bar: 'bg-emerald-500' },
    red:     { bg: 'bg-red-50',     text: 'text-red-700',     bar: 'bg-red-500'     },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-700',   bar: 'bg-amber-500'   },
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map(c => {
        const cm = COLOR_MAP[c.color]
        const Icono = c.icon
        return (
          <div key={c.label} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className={clsx('w-7 h-7 rounded-xl flex items-center justify-center', cm.bg)}>
                <Icono className={clsx('w-3.5 h-3.5', cm.text)} />
              </div>
              <p className="text-xs text-slate-500 flex-1 leading-tight">{c.label}</p>
            </div>
            <p className={clsx('text-xl font-bold', cm.text)}>{c.valor}</p>
            <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={clsx('h-full rounded-full transition-all duration-700', cm.bar)}
                style={{ width: `${Math.min(c.pct, 100)}%` }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-1">{c.sub}</p>
          </div>
        )
      })}
    </div>
  )
}

// ─── Distribución de riesgo ───────────────────────────────────────────────────

function DistribucionRiesgo({ r }: { r: Resumen }) {
  const total = r.riesgo_alto + r.riesgo_medio + r.riesgo_bajo + r.ventaja
  if (total === 0) return null

  const segmentos = [
    { label: 'Alto',    valor: r.riesgo_alto,  color: 'bg-red-400',     text: 'text-red-700'     },
    { label: 'Medio',   valor: r.riesgo_medio, color: 'bg-amber-400',   text: 'text-amber-700'   },
    { label: 'Bajo',    valor: r.riesgo_bajo,  color: 'bg-slate-300',   text: 'text-slate-500'   },
    { label: 'Ventaja', valor: r.ventaja,       color: 'bg-emerald-400', text: 'text-emerald-700' },
  ]

  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Target className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-700">Distribución de riesgo competitivo</h3>
        <span className="text-xs text-slate-400 ml-auto">{total} productos con datos</span>
      </div>

      {/* Barra segmentada */}
      <div className="flex rounded-full overflow-hidden h-4 mb-4 gap-0.5">
        {segmentos.map(s => {
          const pct = Math.round((s.valor / total) * 100)
          if (pct === 0) return null
          return (
            <div
              key={s.label}
              className={clsx('transition-all duration-700', s.color)}
              style={{ width: `${pct}%` }}
              title={`${s.label}: ${s.valor} (${pct}%)`}
            />
          )
        })}
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap gap-4">
        {segmentos.map(s => (
          <div key={s.label} className="flex items-center gap-1.5 text-xs">
            <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', s.color)} />
            <span className={clsx('font-semibold', s.text)}>{s.valor}</span>
            <span className="text-slate-400">{s.label}</span>
            <span className="text-slate-300">({Math.round((s.valor / total) * 100)}%)</span>
          </div>
        ))}
        {r.sin_datos > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-200 flex-shrink-0" />
            <span>{r.sin_datos} sin datos de mercado</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tabla de productos con riesgo ────────────────────────────────────────────

function TablaRiesgo({ productos, filtro }: { productos: ProductoRiesgo[]; filtro: NivelRiesgo | 'todos' }) {
  const lista = filtro === 'todos'
    ? productos
    : productos.filter(p => p.riesgo === filtro)

  if (lista.length === 0) {
    return (
      <p className="text-xs text-slate-400 text-center py-6 italic">
        No hay productos en esta categoría de riesgo
      </p>
    )
  }

  return (
    <div className="divide-y divide-slate-50">
      {lista.map(p => (
        <div key={p.catalogo_id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/50 transition-colors">
          {/* Imagen o placeholder */}
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex-shrink-0 overflow-hidden">
            {p.imagen_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imagen_url} alt={p.nombre} className="w-full h-full object-contain" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Package className="w-4 h-4 text-slate-300" />
              </div>
            )}
          </div>

          {/* Nombre y categoría */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800 truncate">{p.nombre}</p>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {p.marca && <span className="text-xs text-slate-500">{p.marca}</span>}
              {p.categoria && (
                <>
                  <span className="text-xs text-slate-300">·</span>
                  <span className="text-xs text-slate-400">{p.categoria}</span>
                </>
              )}
              {p.n_competidores === 0 && (
                <span className="text-xs text-slate-300 italic">sin competidores</span>
              )}
            </div>
          </div>

          {/* Precios */}
          <div className="hidden md:flex items-center gap-6 flex-shrink-0">
            <div className="text-right">
              <p className="text-xs text-slate-400">PVP</p>
              <p className="text-sm font-semibold text-slate-700">
                {p.pvp_sugerido !== null ? `$${p.pvp_sugerido.toFixed(2)}` : '—'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Mercado avg</p>
              <p className="text-sm font-semibold text-slate-700">
                {p.precio_mercado_avg !== null ? `$${p.precio_mercado_avg.toFixed(2)}` : '—'}
              </p>
            </div>
            <div className="text-right min-w-[64px]">
              <p className="text-xs text-slate-400">Gap</p>
              <p className={clsx('text-sm', colorGap(p.gap_pct))}>
                {p.gap_pct !== null
                  ? <>{p.gap_pct > 0 ? <TrendingUp className="inline w-3 h-3 mr-0.5" /> : <TrendingDown className="inline w-3 h-3 mr-0.5" />}{fmtGap(p.gap_pct)}</>
                  : '—'
                }
              </p>
            </div>
          </div>

          {/* Badge de riesgo */}
          <div className="flex-shrink-0">
            <BadgeRiesgo riesgo={p.riesgo} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Alertas de dumping ───────────────────────────────────────────────────────

function AlertasDumping({ alertas }: { alertas: AlertaDumping[] }) {
  if (alertas.length === 0) return null

  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-red-100">
        <Zap className="w-4 h-4 text-red-600" />
        <h3 className="text-sm font-semibold text-red-800">
          Alertas de posible dumping ({alertas.length})
        </h3>
        <span className="text-xs text-red-400 ml-auto">precio &lt; 70% del promedio del mercado</span>
      </div>

      <div className="divide-y divide-red-100">
        {alertas.map((a, i) => (
          <div key={i} className="px-5 py-3.5 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-900 truncate">{a.nombre_propio}</p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-xs font-medium text-red-700">{a.competidor_nombre}</span>
                {a.competidor_marca && (
                  <span className="text-xs text-red-500">({a.competidor_marca})</span>
                )}
                <span className="text-xs text-red-400">—</span>
                <span className="text-xs text-red-600">
                  precio: <strong>${a.precio_competidor.toFixed(2)}</strong>
                  {' vs mercado avg: '}
                  <strong>${a.precio_mercado_avg.toFixed(2)}</strong>
                </span>
              </div>
              {a.supermercados.length > 0 && (
                <p className="text-xs text-red-400 mt-0.5">
                  En: {a.supermercados.join(', ')}
                </p>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-bold text-red-700">
                {fmtGap(a.diferencia_pct)}
              </p>
              <p className="text-xs text-red-400">vs. mercado</p>
            </div>
          </div>
        ))}
      </div>

      <div className="px-5 py-3 bg-red-100/50">
        <p className="text-xs text-red-600">
          ⚠ Precio significativamente inferior al promedio del mercado. Verificar si es una oferta
          temporal, errónea, o una estrategia de pricing agresiva.
        </p>
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function RiesgoCompetitivo() {
  const [data,     setData]     = useState<RiesgoData | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [filtro,   setFiltro]   = useState<NivelRiesgo | 'todos'>('todos')

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const res = await fetch('/api/proveedores/riesgo')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Error')
      setData(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  if (cargando && !data) {
    return (
      <div className="flex items-center justify-center py-14 gap-2 text-slate-400">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span className="text-sm">Calculando scores de riesgo…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
        <p className="text-sm text-amber-700 mb-3">{error}</p>
        <button onClick={cargar} className="text-xs text-amber-800 underline">Reintentar</button>
      </div>
    )
  }

  if (!data) return null

  if (data.sin_datos || data.productos.length === 0) {
    return (
      <div className="space-y-4">
        {data.resumen && <PenetracionCards r={data.resumen} />}
        <div className="bg-white border border-slate-100 rounded-2xl p-10 text-center">
          <ShieldCheck className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm mb-1">Sin datos de riesgo competitivo</p>
          <p className="text-xs text-slate-400 max-w-xs mx-auto">
            Enlaza tus productos del catálogo a productos scrapeados y agrega competidores
            en la pestaña <strong>Mi Catálogo</strong> para ver el análisis de riesgo.
          </p>
        </div>
      </div>
    )
  }

  const { resumen, productos, dumping } = data

  const FILTROS: { id: NivelRiesgo | 'todos'; label: string; count: number }[] = [
    { id: 'todos',   label: 'Todos',   count: productos.length },
    { id: 'alto',    label: 'Alto',    count: resumen.riesgo_alto  },
    { id: 'medio',   label: 'Medio',   count: resumen.riesgo_medio },
    { id: 'bajo',    label: 'Bajo',    count: resumen.riesgo_bajo  },
    { id: 'ventaja', label: 'Ventaja', count: resumen.ventaja      },
  ]

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-xs text-slate-400">
            Gap = (PVP sugerido − precio mercado) / precio mercado · positivo = más caro que el mercado
          </p>
        </div>
        <button
          onClick={cargar}
          disabled={cargando}
          className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
        >
          <RefreshCw className={clsx('w-3 h-3', cargando && 'animate-spin')} />
          Actualizar
        </button>
      </div>

      {/* Cards de penetración */}
      <PenetracionCards r={resumen} />

      {/* Distribución */}
      <DistribucionRiesgo r={resumen} />

      {/* Alertas de dumping */}
      {dumping.length > 0 && <AlertasDumping alertas={dumping} />}

      {/* Tabla con filtros */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-700">Score por producto</h3>
          </div>

          {/* Filtros */}
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
            {FILTROS.map(f => (
              <button
                key={f.id}
                onClick={() => setFiltro(f.id)}
                className={clsx(
                  'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
                  filtro === f.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {f.id !== 'todos' && (
                  <span className={clsx('w-1.5 h-1.5 rounded-full', RIESGO_CONFIG[f.id as NivelRiesgo].dot)} />
                )}
                {f.label}
                {f.count > 0 && (
                  <span className="text-slate-400 text-[10px]">({f.count})</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <TablaRiesgo productos={productos} filtro={filtro} />
      </div>

      <p className="text-xs text-center text-slate-400">
        Alto {'>'} +15% · Medio +5–15% · Bajo ±5% · Ventaja {'<'} −5% vs. precio promedio de competidores
      </p>
    </div>
  )
}

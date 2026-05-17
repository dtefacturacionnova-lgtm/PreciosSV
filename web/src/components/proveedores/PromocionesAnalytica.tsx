'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  RefreshCw, Tag, TrendingDown, Calendar,
  Store, AlertTriangle, BarChart2, Zap,
} from 'lucide-react'
import clsx from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Resumen {
  total_analizado:     number
  promo_activa:        number
  frecuencia_media_pct: number
  descuento_medio_pct: number
  dias_analizados:     number
}

interface CategoriaStat {
  categoria:       string
  promo_pct:       number
  descuento_avg:   number
  total_registros: number
  activos_ahora:   number
}

interface CompetidorStat {
  cpId:            number
  nombre:          string
  marca:           string
  catalogo_nombre: string
  categoria:       string | null
  total_registros: number
  en_promo:        number
  promo_pct:       number
  descuento_avg:   number
  activo_ahora:    boolean
  descuento_actual: number | null
  supermercados:   string[]
}

interface CadenaStat {
  supermercado:    string
  color:           string
  promo_pct:       number
  descuento_avg:   number
  total_registros: number
}

interface PropiosStat {
  promo_activa:   number
  frecuencia_pct: number
  descuento_avg:  number
}

interface PromoData {
  resumen:            Resumen
  por_categoria:      CategoriaStat[]
  por_competidor:     CompetidorStat[]
  calendario_semanal: Record<string, number>
  por_cadena:         CadenaStat[]
  propios:            PropiosStat
  sin_datos:          boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function RiesgoChip({ pct }: { pct: number }) {
  if (pct >= 40) return <span className="inline-flex items-center gap-1 text-xs font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Alta</span>
  if (pct >= 20) return <span className="inline-flex items-center gap-1 text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Media</span>
  return <span className="inline-flex items-center gap-1 text-xs font-semibold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Baja</span>
}

function BarraHorizontal({ pct, color = '#1D4ED8', max = 100 }: { pct: number; color?: string; max?: number }) {
  const width = max > 0 ? Math.min((pct / max) * 100, 100) : 0
  return (
    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${width}%`, backgroundColor: color }} />
    </div>
  )
}

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function CalendarioSemanal({ data }: { data: Record<string, number> }) {
  const dias = ['0', '1', '2', '3', '4', '5', '6']
  const maxVal = Math.max(...dias.map(d => data[d] ?? 0), 1)

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-700">Actividad promocional por día de semana</h3>
        <span className="text-xs text-slate-400 ml-auto">% relativo al día más activo</span>
      </div>
      <div className="flex items-end gap-2 h-20">
        {dias.map(d => {
          const val  = data[d] ?? 0
          const h    = maxVal > 0 ? Math.round((val / maxVal) * 80) : 4
          const activo = val >= 60
          return (
            <div key={d} className="flex-1 flex flex-col items-center gap-1">
              <div
                className={clsx(
                  'w-full rounded-t-lg transition-all duration-500',
                  activo ? 'bg-blue-600' : val >= 30 ? 'bg-blue-300' : 'bg-slate-100',
                )}
                style={{ height: `${h}px` }}
              />
              <span className={clsx('text-xs font-medium', activo ? 'text-blue-700' : 'text-slate-400')}>
                {DIAS_SEMANA[parseInt(d)]}
              </span>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-slate-400 mt-3">
        Basado en registros históricos de ofertas activas de competidores enlazados.
      </p>
    </div>
  )
}

function TablaCompetidores({ competidores }: { competidores: CompetidorStat[] }) {
  const [filtro, setFiltro] = useState<'todos' | 'activos'>('todos')
  const lista = filtro === 'activos' ? competidores.filter(c => c.activo_ahora) : competidores

  if (lista.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center">
        <Tag className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-slate-500 text-sm">No hay competidores enlazados en esta vista</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-4 border-b border-slate-100 flex-wrap">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-700">Competidores analizados</h3>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {(['todos', 'activos'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                filtro === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {f === 'todos' ? 'Todos' : 'En promo ahora'}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3 min-w-[180px]">Producto</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-3 py-3 min-w-[120px]">Mi producto</th>
              <th className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wide px-3 py-3 min-w-[90px]">Frec. promo</th>
              <th className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wide px-3 py-3 min-w-[90px]">Dcto. avg</th>
              <th className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wide px-3 py-3">Estado</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-3 py-3">Cadenas</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((c, i) => (
              <tr key={`${c.cpId}-${c.catalogo_id}`} className={clsx('border-b border-slate-50', i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30')}>
                <td className="px-4 py-3">
                  <p className="text-sm font-semibold text-slate-800">{c.nombre}</p>
                  {c.marca && <p className="text-xs text-slate-400">{c.marca}</p>}
                  {c.categoria && <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{c.categoria}</span>}
                </td>
                <td className="px-3 py-3">
                  <p className="text-xs text-slate-600">{c.catalogo_nombre}</p>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-sm font-bold text-slate-800">{c.promo_pct}%</span>
                    <BarraHorizontal pct={c.promo_pct} color="#1D4ED8" />
                    <RiesgoChip pct={c.promo_pct} />
                  </div>
                </td>
                <td className="px-3 py-3 text-center">
                  {c.descuento_avg > 0 ? (
                    <span className="text-sm font-bold text-amber-600">−{c.descuento_avg}%</span>
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  {c.activo_ahora ? (
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                        En promo
                      </span>
                      {c.descuento_actual !== null && (
                        <span className="text-xs text-red-600 font-bold">−{c.descuento_actual}%</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {c.supermercados.slice(0, 3).map(s => (
                      <span key={s} className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{s}</span>
                    ))}
                    {c.supermercados.length > 3 && (
                      <span className="text-xs text-slate-400">+{c.supermercados.length - 3}</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function PromocionesAnalytica() {
  const [data,    setData]    = useState<PromoData | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [dias,    setDias]    = useState(60)

  const cargar = useCallback(async (d: number) => {
    setCargando(true)
    setError(null)
    try {
      const res = await fetch(`/api/proveedores/promociones?dias=${d}`)
      if (!res.ok) throw new Error((await res.json()).error ?? 'Error')
      setData(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar(dias) }, [cargar, dias])

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span className="text-sm">Analizando patrones de promoción…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center max-w-lg mx-auto">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
        <p className="text-sm text-amber-700 mb-3">{error}</p>
        <button onClick={() => cargar(dias)} className="text-xs text-amber-800 underline">Reintentar</button>
      </div>
    )
  }

  if (!data || data.sin_datos) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
        <Tag className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <h3 className="font-semibold text-slate-600 mb-1">Sin datos de promociones</h3>
        <p className="text-sm text-slate-400 max-w-sm mx-auto">
          Enlaza competidores en la sección "Mi Catálogo" para analizar sus patrones de oferta.
        </p>
      </div>
    )
  }

  const { resumen, por_categoria, por_competidor, calendario_semanal, por_cadena, propios } = data

  return (
    <div className="space-y-5">

      {/* Selector de rango */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-slate-700">
          Análisis de los últimos <span className="text-blue-700">{resumen.dias_analizados} días</span>
        </h3>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {[30, 60, 90].map(d => (
            <button
              key={d}
              onClick={() => setDias(d)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                dias === d ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {d} días
            </button>
          ))}
        </div>
      </div>

      {/* Cards de resumen */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: 'Competidores analizados',
            val:   resumen.total_analizado,
            sub:   `${resumen.promo_activa} en promo ahora`,
            icon:  Tag,
            color: 'text-blue-700',
          },
          {
            label: 'Frecuencia media de promo',
            val:   `${resumen.frecuencia_media_pct}%`,
            sub:   'de registros históricos',
            icon:  BarChart2,
            color: resumen.frecuencia_media_pct >= 30 ? 'text-red-600' : 'text-amber-600',
          },
          {
            label: 'Descuento promedio',
            val:   `${resumen.descuento_medio_pct}%`,
            sub:   'cuando están en oferta',
            icon:  TrendingDown,
            color: 'text-slate-700',
          },
          {
            label: 'Mis promos activas',
            val:   propios.promo_activa,
            sub:   `Frec. ${propios.frecuencia_pct}% · Dcto. ${propios.descuento_avg}%`,
            icon:  Store,
            color: 'text-emerald-700',
          },
        ].map(({ label, val, sub, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center">
                <Icon className="w-4 h-4 text-slate-400" />
              </div>
              <span className="text-xs text-slate-500 font-medium">{label}</span>
            </div>
            <p className={clsx('text-2xl font-bold', color)}>{val}</p>
            <p className="text-xs text-slate-400 mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* Calendario + Por cadena */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <CalendarioSemanal data={calendario_semanal} />

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Store className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-700">Intensidad por cadena</h3>
          </div>
          {por_cadena.length === 0 ? (
            <p className="text-xs text-slate-400">Sin datos de cadenas</p>
          ) : (
            <div className="space-y-3">
              {por_cadena.map(c => (
                <div key={c.supermercado}>
                  <div className="flex justify-between items-center mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                      <span className="text-sm text-slate-700">{c.supermercado}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400">Dcto. avg {c.descuento_avg}%</span>
                      <span className="text-sm font-bold text-slate-800">{c.promo_pct}%</span>
                    </div>
                  </div>
                  <BarraHorizontal pct={c.promo_pct} color={c.color} max={100} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Por categoría */}
      {por_categoria.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-700">Intensidad promocional por categoría</h3>
          </div>
          <div className="space-y-3">
            {por_categoria.slice(0, 8).map(cat => (
              <div key={cat.categoria} className="flex items-center gap-4">
                <div className="w-28 flex-shrink-0">
                  <p className="text-xs text-slate-600 truncate">{cat.categoria}</p>
                </div>
                <div className="flex-1">
                  <BarraHorizontal
                    pct={cat.promo_pct}
                    color={cat.promo_pct >= 40 ? '#DC2626' : cat.promo_pct >= 20 ? '#F59E0B' : '#64748B'}
                    max={100}
                  />
                </div>
                <div className="w-28 flex-shrink-0 flex items-center gap-2 justify-end">
                  <span className="text-xs text-slate-400">dcto. {cat.descuento_avg}%</span>
                  <span className="text-sm font-bold text-slate-800">{cat.promo_pct}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabla de competidores */}
      <TablaCompetidores competidores={por_competidor} />

    </div>
  )
}

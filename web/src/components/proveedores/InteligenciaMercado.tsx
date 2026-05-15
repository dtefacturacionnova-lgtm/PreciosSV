'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  RefreshCw, AlertTriangle, Plus, X, Save,
  BarChart3, TrendingDown, ShoppingBag,
  Bell, LineChart, LayoutGrid, BarChart2, Zap, ShieldAlert,
} from 'lucide-react'
import clsx from 'clsx'
import AlertasCompetencia from './AlertasCompetencia'
import TendenciasPrecios from './TendenciasPrecios'
import AnaliticasPrecio from './AnaliticasPrecio'
import AnomaliasPrecios from './AnomaliasPrecios'
import ComparativaCatalogo from './ComparativaCatalogo'
import RiesgoCompetitivo from './RiesgoCompetitivo'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Supermercado {
  key:    string
  nombre: string
  color:  string
}

interface MarcaAnalisis {
  precio_promedio:  Record<string, number | null>
  precio_minimo:    Record<string, number | null>
  cobertura:        Record<string, number>
  ofertas:          Record<string, number>
  total_productos:  number
  categorias:       string[]
  es_propio:        boolean
}

interface CompetenciaData {
  marcas_propias: string[]
  competidores:   string[]
  supermercados:  Supermercado[]
  analisis:       Record<string, MarcaAnalisis>
}

type SubTab = 'comparativa' | 'alertas' | 'tendencias' | 'analiticas' | 'anomalias' | 'riesgo'

// ─── Vista: Comparativa ───────────────────────────────────────────────────────

function VistaComparativa({
  data,
  competidores,
  onCompetidoresGuardados,
}: {
  data:                    CompetenciaData
  competidores:            string[]
  onCompetidoresGuardados: (nuevos: string[]) => void
}) {
  const [competidoresEdit, setCompetidoresEdit] = useState<string[]>(competidores)
  const [nuevoComp,        setNuevoComp]        = useState('')
  const [guardando,        setGuardando]        = useState(false)
  const [mensajeOk,        setMensajeOk]        = useState(false)
  const [error,            setError]            = useState<string | null>(null)

  // Sincronizar si cambia el prop externo
  useEffect(() => { setCompetidoresEdit(competidores) }, [competidores])

  function agregarCompetidor() {
    const marca = nuevoComp.trim()
    if (!marca || competidoresEdit.includes(marca)) { setNuevoComp(''); return }
    setCompetidoresEdit(prev => [...prev, marca])
    setNuevoComp('')
  }

  function quitarCompetidor(marca: string) {
    setCompetidoresEdit(prev => prev.filter(c => c !== marca))
  }

  async function guardarCompetidores() {
    setGuardando(true)
    setError(null)
    try {
      const res = await fetch('/api/proveedores/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competidores: competidoresEdit }),
      })
      if (!res.ok) throw new Error()
      setMensajeOk(true)
      setTimeout(() => setMensajeOk(false), 2500)
      onCompetidoresGuardados(competidoresEdit)
    } catch {
      setError('Error al guardar competidores')
    } finally {
      setGuardando(false)
    }
  }

  const { marcas_propias, supermercados, analisis } = data
  const todasLasMarcas = [
    ...marcas_propias,
    ...Object.keys(analisis).filter(m => !marcas_propias.includes(m)),
  ]

  const precioMinPorSuper: Record<string, number> = {}
  for (const super_ of supermercados) {
    const precios = todasLasMarcas
      .map(m => analisis[m]?.precio_promedio[super_.key])
      .filter((p): p is number => p !== null && p !== undefined)
    if (precios.length) precioMinPorSuper[super_.key] = Math.min(...precios)
  }

  return (
    <div className="space-y-5">

      {/* Config: competidores */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-700">Marcas competidoras monitoreadas</h3>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {marcas_propias.map(m => (
            <span key={m} className="inline-flex items-center gap-1.5 bg-blue-100 text-blue-800 text-xs font-semibold px-2.5 py-1 rounded-full">
              {m}
              <span className="text-blue-400 text-[10px] font-normal ml-0.5">tu marca</span>
            </span>
          ))}
          {competidoresEdit.map(m => (
            <span key={m} className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 text-xs font-medium px-2.5 py-1 rounded-full">
              {m}
              <button onClick={() => quitarCompetidor(m)} className="text-slate-400 hover:text-red-500 transition-colors ml-0.5" title={`Quitar ${m}`}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {competidoresEdit.length === 0 && (
            <span className="text-xs text-slate-400 italic">Sin competidores configurados</span>
          )}
        </div>

        <div className="flex gap-2 mt-2 flex-wrap">
          <input
            type="text"
            value={nuevoComp}
            onChange={e => setNuevoComp(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && agregarCompetidor()}
            placeholder="Nombre de la marca (ej. Palmolive)"
            className="flex-1 text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300 min-w-[180px] max-w-sm"
          />
          <button
            onClick={agregarCompetidor}
            className="inline-flex items-center gap-1 text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-3 py-2 rounded-xl transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Agregar
          </button>
          <button
            onClick={guardarCompetidores}
            disabled={guardando}
            className={clsx(
              'inline-flex items-center gap-1 text-sm font-medium px-4 py-2 rounded-xl transition-colors',
              mensajeOk
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50'
            )}
          >
            {guardando ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {mensajeOk ? '¡Guardado!' : 'Guardar'}
          </button>
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        <p className="text-xs text-slate-400 mt-2">
          El nombre debe coincidir exactamente con el campo <code>marca</code> en la base de datos (distingue mayúsculas).
        </p>
      </div>

      {/* Cards de tus marcas */}
      {marcas_propias.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {marcas_propias.map(marca => {
            const a = analisis[marca]
            if (!a) return null
            const totalPreciosKeys = Object.values(a.precio_promedio).filter(Boolean).length
            const totalOfertas     = Object.values(a.ofertas).reduce((s, n) => s + n, 0)
            const avgPrecio        = totalPreciosKeys > 0
              ? Object.values(a.precio_promedio).filter((v): v is number => v !== null && v !== undefined).reduce((s, n) => s + n, 0) / totalPreciosKeys
              : null
            return (
              <div key={marca} className="bg-blue-600 text-white rounded-2xl p-5 shadow-sm">
                <p className="text-xs text-blue-200 mb-1 font-medium">Tu marca</p>
                <p className="text-lg font-bold mb-3">{marca}</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div><p className="text-xl font-bold">{a.total_productos}</p><p className="text-xs text-blue-200">productos</p></div>
                  <div><p className="text-xl font-bold">{totalPreciosKeys}</p><p className="text-xs text-blue-200">cadenas</p></div>
                  <div><p className="text-xl font-bold">{totalOfertas}</p><p className="text-xs text-blue-200">ofertas</p></div>
                </div>
                {avgPrecio && (
                  <p className="text-xs text-blue-200 mt-3">
                    Precio prom. <span className="text-white font-bold">${avgPrecio.toFixed(2)}</span> en todas las cadenas
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Matriz comparativa */}
      {todasLasMarcas.length > 0 && supermercados.length > 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 p-4 border-b border-slate-100">
            <TrendingDown className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-700">Precio promedio por cadena</h3>
            <span className="text-xs text-slate-400 ml-auto">precio promedio efectivo · productos únicos</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide py-3 px-4 min-w-[140px]">Marca</th>
                  <th className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wide py-3 px-3 min-w-[80px]">Productos</th>
                  {supermercados.map(s => (
                    <th key={s.key} className="py-3 px-3 min-w-[110px]">
                      <div className="flex flex-col items-center gap-1">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{s.key}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {todasLasMarcas.map((marca, idx) => {
                  const a         = analisis[marca]
                  const esPropiaFila = marcas_propias.includes(marca)
                  if (!a) return null
                  return (
                    <tr key={marca} className={clsx(
                      'border-b border-slate-50',
                      esPropiaFila ? 'bg-blue-50/40' : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30',
                    )}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {esPropiaFila && <span className="w-1.5 h-1.5 bg-blue-600 rounded-full flex-shrink-0" />}
                          <div>
                            <p className={clsx('text-sm font-semibold', esPropiaFila ? 'text-blue-800' : 'text-slate-700')}>{marca}</p>
                            {esPropiaFila && <p className="text-xs text-blue-400">Tu marca</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <div className="flex flex-col items-center">
                          <ShoppingBag className="w-3.5 h-3.5 text-slate-300 mb-0.5" />
                          <span className={clsx('text-sm font-bold', esPropiaFila ? 'text-blue-700' : 'text-slate-600')}>
                            {a.total_productos}
                          </span>
                        </div>
                      </td>
                      {supermercados.map(s => {
                        const precio_promedio = a.precio_promedio[s.key] ?? null
                        const precio_minimo   = a.precio_minimo[s.key]   ?? null
                        const cobertura       = a.cobertura[s.key]       ?? 0
                        const esMasBarato     = precio_promedio !== null
                          && precioMinPorSuper[s.key] !== undefined
                          && precio_promedio === precioMinPorSuper[s.key]
                        return (
                          <td key={s.key} className={clsx('px-3 py-2.5 text-center', esPropiaFila ? 'bg-blue-50/30' : '')}>
                            {precio_promedio ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <p className={clsx('text-sm font-bold',
                                  esMasBarato ? 'text-emerald-700' : esPropiaFila ? 'text-blue-800' : 'text-slate-700',
                                )}>
                                  ${precio_promedio.toFixed(2)}
                                  {esMasBarato && <span className="ml-0.5 text-emerald-500">↓</span>}
                                </p>
                                {precio_minimo !== null && precio_minimo < precio_promedio && (
                                  <p className="text-xs text-slate-400">mín ${precio_minimo.toFixed(2)}</p>
                                )}
                                <div className="flex items-center gap-0.5 mt-0.5">
                                  <span className="w-1 h-1 rounded-full" style={{ backgroundColor: s.color }} />
                                  <span className="text-xs text-slate-400">{cobertura} prod.</span>
                                </div>
                                {(a.ofertas[s.key] ?? 0) > 0 && (
                                  <span className="text-xs bg-amber-100 text-amber-700 font-bold px-1 rounded-full">
                                    {a.ofertas[s.key]} oferta{a.ofertas[s.key] !== 1 ? 's' : ''}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-slate-200">—</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-blue-600 rounded-full" /> Tu marca</span>
            <span className="flex items-center gap-1"><span className="text-emerald-600 font-bold">↓</span> Precio más bajo en esa cadena</span>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center">
          <BarChart3 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500 text-sm mb-1">Sin datos de competencia todavía</p>
          <p className="text-xs text-slate-400">Agrega marcas competidoras arriba y asegúrate de que estén en la base de datos.</p>
        </div>
      )}
    </div>
  )
}

// ─── ComparativaTab: catálogo (nuevo) + marcas (legacy) ───────────────────────

function ComparativaTab({
  data,
  competidores,
  onCompetidoresGuardados,
}: {
  data:                    CompetenciaData
  competidores:            string[]
  onCompetidoresGuardados: (nuevos: string[]) => void
}) {
  const [vista, setVista] = useState<'catalogo' | 'marcas'>('catalogo')
  return (
    <div className="space-y-4">
      {/* Toggle */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setVista('catalogo')}
          className={clsx(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all',
            vista === 'catalogo' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          Por producto
        </button>
        <button
          onClick={() => setVista('marcas')}
          className={clsx(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all',
            vista === 'marcas' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          Por marca
        </button>
      </div>

      {vista === 'catalogo'
        ? <ComparativaCatalogo />
        : <VistaComparativa data={data} competidores={competidores} onCompetidoresGuardados={onCompetidoresGuardados} />
      }
    </div>
  )
}

// ─── Componente raíz ──────────────────────────────────────────────────────────

export default function InteligenciaMercado() {
  const [data,         setData]         = useState<CompetenciaData | null>(null)
  const [competidores, setCompetidores] = useState<string[]>([])
  const [cargando,     setCargando]     = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [subTab,       setSubTab]       = useState<SubTab>('comparativa')
  const [ultimoUpdate, setUltimoUpdate] = useState<Date>(new Date())
  const intervaloRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const cargar = useCallback(async () => {
    // No mostrar spinner en el auto-refresh (solo en la primera carga)
    setError(null)
    try {
      const [rComp, rConf] = await Promise.all([
        fetch('/api/proveedores/competencia'),
        fetch('/api/proveedores/config'),
      ])
      if (!rComp.ok) throw new Error((await rComp.json()).error ?? 'Error')
      const dComp: CompetenciaData = await rComp.json()
      setData(dComp)
      setUltimoUpdate(new Date())

      if (rConf.ok) {
        const dConf = await rConf.json()
        setCompetidores(dConf.competidores ?? [])
      } else {
        setCompetidores(dComp.competidores)
      }
    } catch (e: any) {
      setError(e.message ?? 'Error desconocido')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
    // Auto-refresh cada 5 minutos en la vista comparativa
    intervaloRef.current = setInterval(cargar, 5 * 60 * 1000)
    return () => { if (intervaloRef.current) clearInterval(intervaloRef.current) }
  }, [cargar])

  // ── Estados ────────────────────────────────────────────────────
  if (cargando) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span className="text-sm">Cargando análisis de mercado…</span>
      </div>
    )
  }

  if (error) {
    const esMigracion = error.toLowerCase().includes('relation') || error.toLowerCase().includes('column')
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center max-w-lg mx-auto mt-6">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
        <h3 className="font-semibold text-amber-800 mb-1">
          {esMigracion ? 'Migración pendiente' : 'Error al cargar datos'}
        </h3>
        <p className="text-sm text-amber-700 mb-3">
          {esMigracion
            ? 'Ejecuta la migración 004 en el SQL Editor de Supabase para activar esta funcionalidad.'
            : error}
        </p>
        {!esMigracion && (
          <button onClick={cargar} className="text-xs text-amber-800 underline">Reintentar</button>
        )}
      </div>
    )
  }

  if (!data) return null

  // ── Sub-tabs ───────────────────────────────────────────────────
  const SUB_TABS: { id: SubTab; label: string; icon: typeof LayoutGrid; badge?: number }[] = [
    { id: 'comparativa', label: 'Comparativa',  icon: LayoutGrid  },
    { id: 'alertas',     label: 'Alertas',      icon: Bell        },
    { id: 'tendencias',  label: 'Tendencias',   icon: LineChart   },
    { id: 'analiticas',  label: 'Analíticas',   icon: BarChart2   },
    { id: 'anomalias',   label: 'Anomalías',    icon: Zap         },
    { id: 'riesgo',      label: 'Riesgo',       icon: ShieldAlert },
  ]

  return (
    <div className="space-y-4">

      {/* Sub-tabs + timestamp */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {SUB_TABS.map(t => {
            const Icono  = t.icon
            const activo = subTab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setSubTab(t.id)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                  activo ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
              >
                <Icono className="w-3.5 h-3.5" />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Auto-refresh indicator */}
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
          Actualizado {ultimoUpdate.toLocaleTimeString('es-SV')}
          <button
            onClick={cargar}
            className="hover:text-slate-600 flex items-center gap-1 ml-1"
            title="Actualizar ahora"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Contenido del sub-tab */}
      {subTab === 'comparativa' && (
        <ComparativaTab
          data={data}
          competidores={competidores}
          onCompetidoresGuardados={nuevos => {
            setCompetidores(nuevos)
            cargar()
          }}
        />
      )}

      {subTab === 'alertas' && (
        <AlertasCompetencia />
      )}

      {subTab === 'tendencias' && (
        <TendenciasPrecios />
      )}

      {subTab === 'analiticas' && (
        <AnaliticasPrecio />
      )}

      {subTab === 'anomalias' && (
        <AnomaliasPrecios />
      )}

      {subTab === 'riesgo' && (
        <RiesgoCompetitivo />
      )}
    </div>
  )
}

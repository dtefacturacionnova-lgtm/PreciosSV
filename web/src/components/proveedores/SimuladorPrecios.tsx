'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'
import {
  Target, RefreshCw, AlertTriangle, Settings,
  TrendingDown, TrendingUp, Minus,
} from 'lucide-react'
import clsx from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CatalogItem {
  id:            number
  nombre:        string
  pvp_sugerido:  number | null
}

interface Competidor {
  nombre:       string
  supermercado: string
  precio:       number
  en_oferta:    boolean
}

interface SimData {
  catalogo_item: {
    id:                   number
    nombre:               string
    imagen_url:           string | null
    pvp_sugerido:         number | null
    precio_propio_actual: number | null
  }
  competidores:   Competidor[]
  catalogo_lista: CatalogItem[]
}

// ─── Modelo de elasticidad simplificado (FMCG: elasticidad -1.5) ─────────────

function impactoVolumen(precioBase: number, precioNuevo: number) {
  const cambioPct = (precioNuevo - precioBase) / precioBase * 100
  const impacto   = -(cambioPct * 1.5)
  return +impacto.toFixed(1)
}

// ─── Tooltip personalizado del gráfico ───────────────────────────────────────

function TooltipPrecio({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow text-xs">
      <p className="font-semibold text-slate-800 mb-0.5">{d.supermercado}</p>
      <p className="text-slate-600 truncate max-w-[160px]">{d.nombre}</p>
      <p className="font-bold text-slate-900 mt-1">${d.precio.toFixed(2)}</p>
      {d.en_oferta && <p className="text-amber-600">En oferta</p>}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function SimuladorPrecios() {
  const [catalogoLista,  setCatalogoLista]  = useState<CatalogItem[]>([])
  const [selectedId,     setSelectedId]     = useState<number | null>(null)
  const [simData,        setSimData]        = useState<SimData | null>(null)
  const [cargandoCat,    setCargandoCat]    = useState(true)
  const [cargandoSim,    setCargandoSim]    = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [precioSlider,   setPrecioSlider]   = useState<number>(0)

  // ── Carga inicial: lista del catálogo ─────────────────────────────
  useEffect(() => {
    fetch('/api/proveedores/simulador')
      .then(r => r.json())
      .then(d => {
        const lista: CatalogItem[] = d.catalogo_lista ?? []
        setCatalogoLista(lista)
        if (lista.length > 0) setSelectedId(lista[0].id)
      })
      .catch(() => setError('Error cargando catálogo'))
      .finally(() => setCargandoCat(false))
  }, [])

  // ── Carga de datos al cambiar el producto ─────────────────────────
  useEffect(() => {
    if (!selectedId) return
    setCargandoSim(true)
    setError(null)
    fetch(`/api/proveedores/simulador?catalog_id=${selectedId}`)
      .then(r => r.json())
      .then((d: SimData) => {
        setSimData(d)
        const ref = d.catalogo_item?.pvp_sugerido ?? d.catalogo_item?.precio_propio_actual
        setPrecioSlider(ref ? +ref.toFixed(2) : 0)
      })
      .catch(() => setError('Error cargando datos de simulación'))
      .finally(() => setCargandoSim(false))
  }, [selectedId])

  // ── Métricas calculadas en cliente ────────────────────────────────
  const metricas = useMemo(() => {
    if (!simData || simData.competidores.length === 0) return null
    const precios = simData.competidores.map(c => c.precio)
    const min     = Math.min(...precios)
    const max     = Math.max(...precios)
    const avg     = precios.reduce((s, n) => s + n, 0) / precios.length

    const vsMin  = (precioSlider - min)  / min  * 100
    const vsAvg  = (precioSlider - avg)  / avg  * 100
    const masCaros  = precios.filter(p => precioSlider < p).length
    const posicion  = Math.round(masCaros / precios.length * 100)

    const base   = simData.catalogo_item.pvp_sugerido
                ?? simData.catalogo_item.precio_propio_actual
                ?? avg
    const volumen = base > 0 ? impactoVolumen(base, precioSlider) : 0

    return { min, max, avg, vsMin, vsAvg, posicion, masCaros, total: precios.length, volumen }
  }, [simData, precioSlider])

  // ── Datos para el gráfico ─────────────────────────────────────────
  const chartData = useMemo(() => {
    if (!simData) return []
    const comps = simData.competidores.map(c => ({
      nombre:       c.nombre,
      supermercado: c.supermercado,
      precio:       c.precio,
      en_oferta:    c.en_oferta,
      esPropio:     false,
    }))
    comps.push({
      nombre:       'Tu precio',
      supermercado: 'Tu precio hipotético',
      precio:       precioSlider,
      en_oferta:    false,
      esPropio:     true,
    })
    return comps.sort((a, b) => a.precio - b.precio)
  }, [simData, precioSlider])

  // ─── Render: estados de carga / vacío ─────────────────────────────

  if (cargandoCat) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span className="text-sm">Cargando catálogo…</span>
      </div>
    )
  }

  if (catalogoLista.length === 0) {
    return (
      <div className="bg-white border border-slate-100 rounded-2xl p-8 text-center">
        <Settings className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-slate-500 text-sm">Sin productos en Mi Catálogo</p>
        <p className="text-xs text-slate-400 mt-1">
          Agrega productos en Mi Catálogo y asigna competidores para usar el simulador.
        </p>
      </div>
    )
  }

  // ─── Render principal ─────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Selector de producto */}
      <div className="bg-white border border-slate-100 rounded-2xl p-4">
        <label className="text-xs font-medium text-slate-500 block mb-2">
          Simular para:
        </label>
        <select
          value={selectedId ?? ''}
          onChange={e => setSelectedId(+e.target.value)}
          className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
        >
          {catalogoLista.map(c => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
      </div>

      {/* Spinner al cambiar producto */}
      {cargandoSim && (
        <div className="flex items-center justify-center py-8 gap-2 text-slate-400">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span className="text-sm">Cargando datos de mercado…</span>
        </div>
      )}

      {/* Error */}
      {error && !cargandoSim && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-700">{error}</p>
        </div>
      )}

      {/* Sin competidores */}
      {simData && !cargandoSim && simData.competidores.length === 0 && (
        <div className="bg-white border border-slate-100 rounded-2xl p-6 text-center">
          <Target className="w-6 h-6 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Sin competidores enlazados</p>
          <p className="text-xs text-slate-400 mt-1">
            Asigna competidores a este producto en Mi Catálogo para simular.
          </p>
        </div>
      )}

      {/* Simulador completo */}
      {simData && !cargandoSim && simData.competidores.length > 0 && metricas && (
        <>
          {/* Slider de precio */}
          <div className="bg-white border border-slate-100 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-slate-700">
                Precio hipotético
              </span>
              <span className="text-2xl font-bold text-blue-600">
                ${precioSlider.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={+(metricas.min * 0.6).toFixed(2)}
              max={+(metricas.max * 1.4).toFixed(2)}
              step={0.01}
              value={precioSlider}
              onChange={e => setPrecioSlider(+e.target.value)}
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-xs text-slate-400 mt-1">
              <span>${(metricas.min * 0.6).toFixed(2)}</span>
              <span>
                {simData.catalogo_item.pvp_sugerido && (
                  <button
                    onClick={() => setPrecioSlider(simData.catalogo_item.pvp_sugerido!)}
                    className="text-blue-500 hover:underline mr-3"
                  >
                    Restablecer PVP
                  </button>
                )}
              </span>
              <span>${(metricas.max * 1.4).toFixed(2)}</span>
            </div>
          </div>

          {/* Tarjetas de métricas */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

            {/* vs mínimo */}
            <div className="bg-white border border-slate-100 rounded-2xl p-4">
              <p className="text-xs text-slate-400 mb-1">vs. precio mínimo</p>
              <p className={clsx('text-xl font-bold',
                metricas.vsMin > 15  ? 'text-red-600'
                : metricas.vsMin < 0 ? 'text-emerald-600'
                : 'text-slate-700'
              )}>
                {metricas.vsMin > 0 ? '+' : ''}{metricas.vsMin.toFixed(1)}%
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                mín: ${metricas.min.toFixed(2)}
              </p>
            </div>

            {/* vs promedio */}
            <div className="bg-white border border-slate-100 rounded-2xl p-4">
              <p className="text-xs text-slate-400 mb-1">vs. promedio mercado</p>
              <p className={clsx('text-xl font-bold',
                metricas.vsAvg > 10   ? 'text-amber-600'
                : metricas.vsAvg < -10 ? 'text-emerald-600'
                : 'text-slate-700'
              )}>
                {metricas.vsAvg > 0 ? '+' : ''}{metricas.vsAvg.toFixed(1)}%
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                prom: ${metricas.avg.toFixed(2)}
              </p>
            </div>

            {/* posición */}
            <div className="bg-white border border-slate-100 rounded-2xl p-4">
              <p className="text-xs text-slate-400 mb-1">competidores más caros</p>
              <p className={clsx('text-xl font-bold',
                metricas.posicion > 60 ? 'text-emerald-600'
                : metricas.posicion < 30 ? 'text-red-600'
                : 'text-slate-700'
              )}>
                {metricas.posicion}%
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {metricas.masCaros} de {metricas.total}
              </p>
            </div>

            {/* impacto volumen */}
            <div className="bg-white border border-slate-100 rounded-2xl p-4">
              <p className="text-xs text-slate-400 mb-1">impacto volumen est.</p>
              <div className="flex items-center gap-1.5">
                {metricas.volumen > 0
                  ? <TrendingUp className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  : metricas.volumen < 0
                  ? <TrendingDown className="w-4 h-4 text-red-500 flex-shrink-0" />
                  : <Minus className="w-4 h-4 text-slate-400 flex-shrink-0" />
                }
                <p className={clsx('text-xl font-bold',
                  metricas.volumen > 0  ? 'text-emerald-600'
                  : metricas.volumen < 0 ? 'text-red-600'
                  : 'text-slate-700'
                )}>
                  {metricas.volumen > 0 ? '+' : ''}{metricas.volumen}%
                </p>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">elasticidad FMCG −1.5</p>
            </div>
          </div>

          {/* Gráfico comparativo */}
          <div className="bg-white border border-slate-100 rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">
              Posicionamiento de precio
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 28 }}>
                <XAxis
                  dataKey="supermercado"
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  angle={-30}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  tickFormatter={v => `$${v}`}
                  domain={[
                    (min: number) => +(min * 0.9).toFixed(0),
                    (max: number) => +(max * 1.05).toFixed(0),
                  ]}
                />
                <Tooltip content={<TooltipPrecio />} />
                <ReferenceLine
                  y={metricas.avg}
                  stroke="#94a3b8"
                  strokeDasharray="4 2"
                  label={{ value: 'prom', position: 'right', fontSize: 9, fill: '#94a3b8' }}
                />
                <Bar dataKey="precio" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, idx) => (
                    <Cell
                      key={idx}
                      fill={
                        entry.esPropio   ? '#3B82F6'
                        : entry.en_oferta ? '#F59E0B'
                        : '#CBD5E1'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex gap-4 justify-center mt-1 flex-wrap">
              {[
                { color: 'bg-blue-500',   label: 'Tu precio' },
                { color: 'bg-slate-300',  label: 'Competidor' },
                { color: 'bg-amber-400',  label: 'En oferta' },
              ].map(({ color, label }) => (
                <span key={label} className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className={`w-3 h-3 rounded flex-shrink-0 ${color}`} />
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Tabla de competidores */}
          <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">
                Detalle por competidor
              </h3>
              <span className="text-xs text-slate-400">
                {simData.competidores.length} competidores
              </span>
            </div>
            <div className="divide-y divide-slate-50">
              {[...simData.competidores]
                .sort((a, b) => a.precio - b.precio)
                .map((comp, idx) => {
                  const gap = (precioSlider - comp.precio) / comp.precio * 100
                  return (
                    <div key={idx} className="flex items-center px-5 py-3 gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-700 truncate">
                          {comp.nombre}
                        </p>
                        <p className="text-xs text-slate-400">{comp.supermercado}</p>
                      </div>
                      <div className="text-right mr-3">
                        <p className="text-sm font-semibold text-slate-800">
                          ${comp.precio.toFixed(2)}
                        </p>
                        {comp.en_oferta && (
                          <span className="text-[10px] text-amber-600 font-medium">
                            oferta
                          </span>
                        )}
                      </div>
                      <span className={clsx(
                        'text-xs font-semibold px-2 py-0.5 rounded-full min-w-[52px] text-center',
                        gap > 10  ? 'bg-red-50 text-red-700'
                        : gap < -10 ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                      )}>
                        {gap > 0 ? '+' : ''}{gap.toFixed(0)}%
                      </span>
                    </div>
                  )
                })}
            </div>
          </div>

          <p className="text-xs text-center text-slate-400">
            Impacto estimado basado en elasticidad precio-demanda FMCG (−1.5) ·
            Desliza para explorar escenarios
          </p>
        </>
      )}
    </div>
  )
}

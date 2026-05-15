'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Bell, RefreshCw, Package, ChevronDown, ChevronUp,
  Zap, Clock, AlertTriangle, Settings, Download,
  TrendingUp, Timer, ShoppingBag,
} from 'lucide-react'
import clsx from 'clsx'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

type EstadoOferta   = 'nueva' | 'reciente' | 'vigente'
type FrecuenciaPromos = 'frecuente' | 'moderada' | 'ocasional'

interface OfertaItem {
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
  estado:        EstadoOferta
}

interface AlertaMarca {
  marca:                       string
  total:                       number
  frecuencia_promos:           FrecuenciaPromos
  dias_promo_ultimo_90d:       number
  duracion_promedio_dias:      number | null
  productos_propios_afectados: number
  ofertas:                     OfertaItem[]
}

interface AlertasData {
  alertas:            AlertaMarca[]
  total_ofertas:      number
  tiene_competidores: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ESTADO_META: Record<EstadoOferta, { label: string; color: string; bg: string; icon: typeof Zap }> = {
  nueva:    { label: 'Nueva',    color: 'text-red-700',   bg: 'bg-red-100',   icon: Zap   },
  reciente: { label: 'Reciente', color: 'text-amber-700', bg: 'bg-amber-100', icon: Clock },
  vigente:  { label: 'Vigente',  color: 'text-slate-600', bg: 'bg-slate-100', icon: Bell  },
}

const FRECUENCIA_META: Record<FrecuenciaPromos, { label: string; dot: string; chip: string }> = {
  frecuente: { label: 'Promociones: frecuentes',  dot: 'bg-red-500',    chip: 'bg-red-50 text-red-700'       },
  moderada:  { label: 'Promociones: moderadas',   dot: 'bg-amber-400',  chip: 'bg-amber-50 text-amber-700'   },
  ocasional: { label: 'Promociones: ocasionales', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700' },
}

function tiempoRelativo(horas: number | null): string {
  if (horas === null) return ''
  if (horas < 1)  return 'hace menos de 1 hora'
  if (horas < 24) return `hace ${horas}h`
  const dias = Math.floor(horas / 24)
  return `hace ${dias} día${dias !== 1 ? 's' : ''}`
}

// ─── Tarjeta de producto en oferta ───────────────────────────────────────────

function TarjetaOferta({ oferta }: { oferta: OfertaItem }) {
  const m    = ESTADO_META[oferta.estado]
  const Icon = m.icon
  const pct  = oferta.descuento_pct

  return (
    <div className={clsx(
      'flex items-start gap-3 bg-white border rounded-xl p-3 transition-all',
      oferta.estado === 'nueva'    ? 'border-red-200 shadow-sm shadow-red-50'     :
      oferta.estado === 'reciente' ? 'border-amber-200 shadow-sm shadow-amber-50' :
                                     'border-slate-100'
    )}>
      {/* Imagen */}
      <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
        {oferta.imagen_url ? (
          <img src={oferta.imagen_url} alt={oferta.nombre} className="max-h-8 max-w-8 object-contain" />
        ) : (
          <Package className="w-4 h-4 text-slate-400" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800 truncate">{oferta.nombre}</p>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: oferta.color }} />
              <span className="text-xs text-slate-500">{oferta.supermercado}</span>
              {oferta.categoria && (
                <span className="text-xs text-slate-400">· {oferta.categoria}</span>
              )}
            </div>
          </div>

          {/* Badge de estado */}
          <span className={clsx('inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0', m.bg, m.color)}>
            <Icon className="w-3 h-3" />
            {m.label}
          </span>
        </div>

        {/* Precio */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {oferta.precio_oferta ? (
            <>
              <span className="text-xs text-slate-400 line-through">${oferta.precio_normal.toFixed(2)}</span>
              <span className="text-base font-bold text-amber-700">${oferta.precio_oferta.toFixed(2)}</span>
            </>
          ) : (
            <span className="text-base font-bold text-slate-700">${oferta.precio_normal.toFixed(2)}</span>
          )}

          {pct && (
            <span className="text-xs font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
              -{pct.toFixed(0)}% OFF
            </span>
          )}

          {oferta.horas_activa !== null && (
            <span className="text-xs text-slate-400 ml-auto">
              {tiempoRelativo(oferta.horas_activa)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Chips de contexto histórico ─────────────────────────────────────────────

function ChipsHistorico({ alerta }: { alerta: AlertaMarca }) {
  const fm = FRECUENCIA_META[alerta.frecuencia_promos]

  return (
    <div className="flex flex-wrap gap-2 px-4 pb-3">
      {/* Frecuencia */}
      <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full', fm.chip)}>
        <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', fm.dot)} />
        {fm.label}
      </span>

      {/* Duración típica */}
      {alerta.duracion_promedio_dias !== null && (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
          <Timer className="w-3 h-3 flex-shrink-0" />
          Duración típica: ~{alerta.duracion_promedio_dias} día{alerta.duracion_promedio_dias !== 1 ? 's' : ''}
        </span>
      )}

      {/* Productos propios afectados */}
      {alerta.productos_propios_afectados > 0 && (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">
          <ShoppingBag className="w-3 h-3 flex-shrink-0" />
          {alerta.productos_propios_afectados} tuyo{alerta.productos_propios_afectados !== 1 ? 's' : ''} en misma categoría
        </span>
      )}
    </div>
  )
}

// ─── Grupo de marca ───────────────────────────────────────────────────────────

function GrupoMarca({ alerta }: { alerta: AlertaMarca }) {
  const [expandido, setExpandido] = useState(true)
  const nuevas    = alerta.ofertas.filter(o => o.estado === 'nueva').length
  const recientes = alerta.ofertas.filter(o => o.estado === 'reciente').length

  return (
    <div className="bg-slate-50/60 border border-slate-100 rounded-2xl overflow-hidden">
      {/* Cabecera */}
      <button
        onClick={() => setExpandido(v => !v)}
        className="w-full flex items-center gap-3 p-4 hover:bg-slate-100/60 transition-colors text-left"
      >
        <Bell className="w-4 h-4 text-slate-400 flex-shrink-0" />
        <span className="font-semibold text-slate-800 flex-1">{alerta.marca}</span>

        {/* Badges rápidos */}
        <div className="flex items-center gap-1.5">
          {nuevas > 0 && (
            <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
              {nuevas} nueva{nuevas !== 1 ? 's' : ''}
            </span>
          )}
          {recientes > 0 && (
            <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              {recientes} reciente{recientes !== 1 ? 's' : ''}
            </span>
          )}
          <span className="text-xs text-slate-400">{alerta.total} oferta{alerta.total !== 1 ? 's' : ''}</span>
          {expandido ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </button>

      {/* Chips de contexto histórico — siempre visibles */}
      <ChipsHistorico alerta={alerta} />

      {/* Listado */}
      {expandido && (
        <div className="px-4 pb-4 grid gap-2 grid-cols-1 md:grid-cols-2">
          {alerta.ofertas.map((o, i) => (
            <TarjetaOferta key={`${o.variante_id}-${i}`} oferta={o} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function AlertasCompetencia() {
  const [data,           setData]           = useState<AlertasData | null>(null)
  const [cargando,       setCargando]       = useState(true)
  const [error,          setError]          = useState<string | null>(null)
  const [ahora,          setAhora]          = useState<Date>(new Date())
  const [cargandoExport, setCargandoExport] = useState(false)

  async function descargar(tipo: string, params = '') {
    setCargandoExport(true)
    try {
      const res = await fetch(`/api/proveedores/exportar?tipo=${tipo}&formato=csv${params}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `preciosv_${tipo}_${new Date().toISOString().split('T')[0]}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setCargandoExport(false)
    }
  }

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const res = await fetch('/api/proveedores/alertas')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Error')
      setData(await res.json())
      setAhora(new Date())
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

  // ── Sin competidores configurados ─────────────────────────────
  if (data?.tiene_competidores === false) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center">
        <Settings className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <h3 className="font-semibold text-slate-700 mb-1">Sin competidores configurados</h3>
        <p className="text-sm text-slate-500 mb-4">
          Ve a la pestaña <strong>Comparativa</strong> y agrega las marcas competidoras que quieres monitorear.
        </p>
      </div>
    )
  }

  if (cargando && !data) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span className="text-sm">Buscando alertas…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-700">{error}</p>
        <button onClick={cargar} className="mt-3 text-xs text-red-600 underline">Reintentar</button>
      </div>
    )
  }

  if (!data) return null

  // ── Sin ofertas activas ────────────────────────────────────────
  if (data.alertas.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">Actualizado: {ahora.toLocaleTimeString('es-SV')}</p>
          <button onClick={cargar} disabled={cargando} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
            <RefreshCw className={clsx('w-3 h-3', cargando && 'animate-spin')} /> Actualizar
          </button>
        </div>
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-8 text-center">
          <Bell className="w-8 h-8 text-emerald-300 mx-auto mb-2" />
          <h3 className="font-semibold text-emerald-800 mb-1">Sin ofertas de competidores</h3>
          <p className="text-sm text-emerald-700">
            Ninguno de tus competidores tiene promociones activas en este momento.
          </p>
        </div>
      </div>
    )
  }

  // ── Nueva badge de alertas ──────────────────────────────────────
  const totalNuevas    = data.alertas.reduce((s, a) => s + a.ofertas.filter(o => o.estado === 'nueva').length, 0)
  const totalRecientes = data.alertas.reduce((s, a) => s + a.ofertas.filter(o => o.estado === 'reciente').length, 0)

  return (
    <div className="space-y-4">
      {/* Header con resumen */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-700 text-sm">
            {data.total_ofertas} oferta{data.total_ofertas !== 1 ? 's' : ''} activa{data.total_ofertas !== 1 ? 's' : ''}
          </span>
          {totalNuevas > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-bold bg-red-100 text-red-700 px-2.5 py-1 rounded-full">
              <Zap className="w-3 h-3" /> {totalNuevas} nueva{totalNuevas !== 1 ? 's' : ''} (≤48h)
            </span>
          )}
          {totalRecientes > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-bold bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full">
              <Clock className="w-3 h-3" /> {totalRecientes} reciente{totalRecientes !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => descargar('alertas')}
            disabled={cargandoExport}
            className="inline-flex items-center gap-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
          >
            {cargandoExport
              ? <RefreshCw className="w-3 h-3 animate-spin" />
              : <Download className="w-3 h-3" />
            }
            Exportar CSV
          </button>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>{ahora.toLocaleTimeString('es-SV')}</span>
            <button onClick={cargar} disabled={cargando} className="hover:text-slate-600 flex items-center gap-1">
              <RefreshCw className={clsx('w-3 h-3', cargando && 'animate-spin')} /> Actualizar
            </button>
          </div>
        </div>
      </div>

      {/* Grupos por marca */}
      <div className="space-y-3">
        {data.alertas.map(alerta => (
          <GrupoMarca key={alerta.marca} alerta={alerta} />
        ))}
      </div>

      <p className="text-xs text-center text-slate-400">
        Se actualiza automáticamente cada 5 minutos · Solo muestra productos con <code>en_oferta = true</code> en este momento
      </p>
    </div>
  )
}

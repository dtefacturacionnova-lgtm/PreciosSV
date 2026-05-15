'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Lightbulb, RefreshCw, TrendingDown, TrendingUp, Minus,
  Package, AlertTriangle, Settings,
} from 'lucide-react'
import clsx from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Recomendacion {
  producto_id:             number
  nombre:                  string
  imagen_url:              string | null
  precio_propio_actual:    number
  precio_mercado_min:      number
  precio_mercado_promedio: number
  precio_mercado_max:      number
  recomendacion:           string
  accion:                  'bajar' | 'subir' | 'mantener'
  prioridad:               'alta' | 'media' | 'baja'
  impacto_estimado:        string
  comparacion_tipo?:       'categoria' | 'global'
}

interface RecomendacionesData {
  recomendaciones: Recomendacion[]
  total:           number
}

// ─── Helpers de estilo ────────────────────────────────────────────────────────

const ACCION_META: Record<Recomendacion['accion'], {
  label: string
  bg:    string
  text:  string
  icon:  typeof TrendingDown
}> = {
  bajar:    { label: 'BAJAR',    bg: 'bg-red-100',    text: 'text-red-700',     icon: TrendingDown },
  subir:    { label: 'SUBIR',    bg: 'bg-emerald-100', text: 'text-emerald-700', icon: TrendingUp   },
  mantener: { label: 'MANTENER', bg: 'bg-slate-100',  text: 'text-slate-600',   icon: Minus        },
}

const PRIORIDAD_META: Record<Recomendacion['prioridad'], {
  label: string
  bg:    string
  text:  string
}> = {
  alta:  { label: 'Alta',  bg: 'bg-red-50',      text: 'text-red-600'    },
  media: { label: 'Media', bg: 'bg-amber-50',    text: 'text-amber-600'  },
  baja:  { label: 'Baja',  bg: 'bg-slate-50',    text: 'text-slate-500'  },
}

// ─── Tarjeta de recomendación ─────────────────────────────────────────────────

function TarjetaRecomendacion({ rec }: { rec: Recomendacion }) {
  const accion   = ACCION_META[rec.accion]
  const prioridad = PRIORIDAD_META[rec.prioridad]
  const IconAccion = accion.icon

  return (
    <div className={clsx(
      'flex items-start gap-3 bg-white border rounded-2xl p-4 transition-all',
      rec.prioridad === 'alta'
        ? 'border-red-200 shadow-sm shadow-red-50'
        : rec.prioridad === 'media'
          ? 'border-amber-100'
          : 'border-slate-100',
    )}>
      {/* Imagen del producto */}
      <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
        {rec.imagen_url ? (
          <img
            src={rec.imagen_url}
            alt={rec.nombre}
            className="max-h-8 max-w-8 object-contain"
          />
        ) : (
          <Package className="w-4 h-4 text-slate-400" />
        )}
      </div>

      {/* Info principal */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-sm font-semibold text-slate-800 truncate flex-1">{rec.nombre}</p>

          {/* Badge de acción */}
          <span className={clsx(
            'inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0',
            accion.bg, accion.text,
          )}>
            <IconAccion className="w-3 h-3" />
            {accion.label}
          </span>
        </div>

        {/* Precios */}
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <div>
            <p className="text-xs text-slate-400">Tu precio actual</p>
            <p className="text-base font-bold text-slate-800">
              ${rec.precio_propio_actual.toFixed(2)}
            </p>
          </div>
          <div className="text-slate-300">vs.</div>
          <div>
            <p className="text-xs text-slate-400">Rango mercado</p>
            <p className="text-sm font-semibold text-slate-600">
              ${rec.precio_mercado_min.toFixed(2)}
              <span className="text-slate-400 font-normal"> — </span>
              ${rec.precio_mercado_max.toFixed(2)}
            </p>
            <p className="text-xs text-slate-400">
              prom. ${rec.precio_mercado_promedio.toFixed(2)}
            </p>
          </div>
        </div>

        {/* Texto de recomendación */}
        <p className="text-xs text-slate-600 leading-relaxed mb-2">{rec.recomendacion}</p>

        {/* Impacto + prioridad + tipo comparación */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400">{rec.impacto_estimado}</span>
          {rec.comparacion_tipo && (
            <span className={clsx(
              'text-[10px] font-medium px-1.5 py-0.5 rounded-full',
              rec.comparacion_tipo === 'categoria'
                ? 'bg-violet-50 text-violet-600'
                : 'bg-slate-100 text-slate-500',
            )}>
              {rec.comparacion_tipo === 'categoria' ? 'Por categoría' : 'Mercado global'}
            </span>
          )}
          <span className={clsx(
            'text-xs font-semibold px-2 py-0.5 rounded-full ml-auto',
            prioridad.bg, prioridad.text,
          )}>
            Prioridad {prioridad.label}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function RecomendacionesPrecio() {
  const [data,     setData]     = useState<RecomendacionesData | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const res = await fetch('/api/proveedores/recomendaciones')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Error')
      setData(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // ── Cargando ────────────────────────────────────────────────────
  if (cargando && !data) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span className="text-sm">Generando recomendaciones…</span>
      </div>
    )
  }

  // ── Error ───────────────────────────────────────────────────────
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

  // ── Sin datos (sin competidores) ────────────────────────────────
  if (data.total === 0) {
    return (
      <div className="bg-white border border-slate-100 rounded-2xl p-8 text-center">
        <Settings className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-slate-500 text-sm mb-1">Sin recomendaciones disponibles</p>
        <p className="text-xs text-slate-400">
          Configura tus competidores en la pestaña Comparativa para ver recomendaciones de precio.
        </p>
      </div>
    )
  }

  const altaPrioridad = data.recomendaciones.filter(r => r.prioridad === 'alta').length

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-slate-700">
            {data.total} recomendación{data.total !== 1 ? 'es' : ''}
          </h3>
          {altaPrioridad > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-bold bg-red-100 text-red-700 px-2.5 py-1 rounded-full">
              {altaPrioridad} de alta prioridad
            </span>
          )}
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

      {/* Lista de recomendaciones */}
      <div className="space-y-3">
        {data.recomendaciones.map(rec => (
          <TarjetaRecomendacion key={rec.producto_id} rec={rec} />
        ))}
      </div>

      <p className="text-xs text-center text-slate-400">
        Comparación por categoría cuando hay ≥2 precios de competidores en la misma; mercado global como fallback
      </p>
    </div>
  )
}

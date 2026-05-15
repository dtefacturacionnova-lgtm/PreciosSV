'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  CheckCircle2, AlertTriangle, TrendingDown, HelpCircle,
  RefreshCw, Package, Pencil, X, Check, ChevronDown, ChevronUp,
  Download,
} from 'lucide-react'
import clsx from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

type Estado = 'ok' | 'alto' | 'bajo' | 'sin_datos'

interface TiendaCumplimiento {
  supermercado:    string
  key:             string
  color:           string
  precio_normal:   number
  precio_oferta:   number | null
  en_oferta:       boolean
  precio_efectivo: number
  pvp_sugerido:    number | null
  desviacion_pct:  number | null
  estado:          Estado
}

interface ProductoCumplimiento {
  catalogo_id:  number
  nombre:       string
  marca:        string | null
  descripcion:  string | null
  imagen_url:   string | null
  pvp_sugerido: number | null
  enlazado:     boolean
  tiendas:      TiendaCumplimiento[]
  resumen:      Record<Estado, number>
}

interface ResumenGlobal {
  total_ok:        number
  total_alto:      number
  total_bajo:      number
  total_sin_datos: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ESTADO_META: Record<Estado, { label: string; color: string; bg: string; icon: typeof CheckCircle2 }> = {
  ok:        { label: 'En rango',           color: 'text-emerald-700', bg: 'bg-emerald-100', icon: CheckCircle2 },
  alto:      { label: 'Sobre el PVP',       color: 'text-amber-700',  bg: 'bg-amber-100',   icon: AlertTriangle },
  bajo:      { label: 'Bajo el PVP',        color: 'text-red-700',    bg: 'bg-red-100',     icon: TrendingDown },
  sin_datos: { label: 'Sin datos scraped',  color: 'text-slate-500',  bg: 'bg-slate-100',   icon: HelpCircle   },
}

function BadgeEstado({ estado, desviacion }: { estado: Estado; desviacion: number | null }) {
  const m = ESTADO_META[estado]
  const Icono = m.icon
  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full', m.bg, m.color)}>
      <Icono className="w-3 h-3" />
      {desviacion !== null ? `${desviacion > 0 ? '+' : ''}${desviacion.toFixed(1)}%` : m.label}
    </span>
  )
}

// ─── Formulario inline de PVP ────────────────────────────────────────────────

interface FormPVPProps {
  catalogoId:   number
  pvpActual:    number | null
  onGuardado:   (pvp: number | null) => void
  onCancelar:   () => void
}

function FormPVP({ catalogoId, pvpActual, onGuardado, onCancelar }: FormPVPProps) {
  const [pvp,      setPvp]      = useState(pvpActual?.toString() ?? '')
  const [guardando, setGuardando] = useState(false)
  const [err,      setErr]      = useState('')

  async function guardar() {
    const pvpNum = pvp.trim() ? parseFloat(pvp) : null
    if (pvp.trim() && isNaN(pvpNum!)) { setErr('Precio inválido'); return }
    setGuardando(true); setErr('')
    try {
      const res = await fetch(`/api/proveedores/catalogo/${catalogoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pvp_sugerido: pvpNum }),
      })
      if (!res.ok) throw new Error()
      onGuardado(pvpNum)
    } catch {
      setErr('Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="mt-2 p-3 bg-blue-50 border border-blue-100 rounded-xl text-sm space-y-2">
      <p className="font-medium text-blue-800 text-xs mb-1">PVP sugerido del proveedor</p>
      <div className="flex items-end gap-2">
        <div>
          <label className="block text-xs text-slate-500 mb-0.5">PVP sugerido ($)</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
            <input
              type="number" min="0" step="0.01"
              value={pvp} onChange={e => setPvp(e.target.value)}
              placeholder="0.00"
              className="w-28 pl-5 pr-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        </div>
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2 pt-1">
        <button onClick={guardar} disabled={guardando}
          className="inline-flex items-center gap-1 bg-blue-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {guardando ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          Guardar
        </button>
        <button onClick={onCancelar} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5">
          Cancelar
        </button>
      </div>
    </div>
  )
}

// ─── Fila de producto ─────────────────────────────────────────────────────────

function FilaProducto({
  prod,
  onActualizar,
}: {
  prod:         ProductoCumplimiento
  onActualizar: (catalogoId: number, pvp: number | null) => void
}) {
  const [expandido, setExpandido] = useState(false)
  const [editando,  setEditando]  = useState(false)

  const sinPvp = !prod.pvp_sugerido

  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden mb-2">
      {/* Cabecera */}
      <div
        className="flex items-center gap-3 p-3 bg-white hover:bg-slate-50/60 cursor-pointer transition-colors"
        onClick={() => setExpandido(v => !v)}
      >
        {/* Icono */}
        <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
          {prod.imagen_url
            ? <img src={prod.imagen_url} alt={prod.nombre} className="max-h-7 max-w-7 object-contain" />
            : <Package className="w-4 h-4 text-slate-400" />
          }
        </div>

        {/* Nombre */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">{prod.nombre}</p>
          <p className="text-xs text-slate-400">
            {prod.marca}{prod.descripcion ? ` · ${prod.descripcion}` : ''}
            {!prod.enlazado && <span className="ml-1 text-amber-500">· sin enlace EAN</span>}
          </p>
        </div>

        {/* PVP sugerido */}
        <div
          className="text-right mr-2 flex-shrink-0"
          onClick={e => { e.stopPropagation(); setExpandido(true); setEditando(true) }}
        >
          {prod.pvp_sugerido ? (
            <div className="group flex items-center gap-1 cursor-pointer">
              <div>
                <p className="text-xs text-slate-400">PVP ref.</p>
                <p className="text-sm font-bold text-slate-700">${prod.pvp_sugerido.toFixed(2)}</p>
              </div>
              <Pencil className="w-3 h-3 text-slate-300 group-hover:text-blue-500 transition-colors" />
            </div>
          ) : (
            <button className="text-xs text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap">
              + Agregar PVP
            </button>
          )}
        </div>

        {/* Pills de estado */}
        <div className="flex gap-1.5 flex-shrink-0">
          {prod.resumen.ok > 0 && (
            <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">{prod.resumen.ok} ✓</span>
          )}
          {prod.resumen.alto > 0 && (
            <span className="text-xs font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{prod.resumen.alto} ↑</span>
          )}
          {prod.resumen.bajo > 0 && (
            <span className="text-xs font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">{prod.resumen.bajo} ↓</span>
          )}
          {sinPvp && (
            <span className="text-xs font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">Sin PVP</span>
          )}
        </div>

        <div className="text-slate-300 flex-shrink-0">
          {expandido ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {/* Detalle expandido */}
      {expandido && (
        <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-3">
          {editando ? (
            <FormPVP
              catalogoId={prod.catalogo_id}
              pvpActual={prod.pvp_sugerido}
              onGuardado={pvp => { onActualizar(prod.catalogo_id, pvp); setEditando(false) }}
              onCancelar={() => setEditando(false)}
            />
          ) : (
            <button
              onClick={() => setEditando(true)}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 mb-3"
            >
              <Pencil className="w-3 h-3" />
              {prod.pvp_sugerido ? 'Editar PVP de referencia' : 'Registrar PVP de referencia'}
            </button>
          )}

          {prod.tiendas.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {prod.tiendas.map(t => (
                <div
                  key={t.key}
                  className={clsx(
                    'flex flex-col gap-0.5 bg-white border rounded-xl px-3 py-2 min-w-[120px]',
                    t.estado === 'ok'   ? 'border-emerald-200' :
                    t.estado === 'alto' ? 'border-amber-200'   :
                    t.estado === 'bajo' ? 'border-red-200'     : 'border-slate-100'
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                    <span className="text-xs text-slate-500 font-medium truncate">{t.supermercado}</span>
                  </div>
                  <p className="text-sm font-bold text-slate-800">${t.precio_efectivo.toFixed(2)}</p>
                  {t.en_oferta && t.precio_oferta && (
                    <p className="text-xs text-slate-400 line-through">${t.precio_normal.toFixed(2)}</p>
                  )}
                  <BadgeEstado estado={t.estado} desviacion={t.desviacion_pct} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic">
              {prod.enlazado
                ? 'Sin precios scraped aún — aparecerán después del primer ciclo de scraping.'
                : 'Agrega un EAN al producto en "Mi Catálogo" para activar el monitoreo automático.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function CumplimientoPrecios() {
  const [productos,      setProductos]      = useState<ProductoCumplimiento[]>([])
  const [resumen,        setResumen]        = useState<ResumenGlobal>({ total_ok: 0, total_alto: 0, total_bajo: 0, total_sin_datos: 0 })
  const [cargando,       setCargando]       = useState(true)
  const [error,          setError]          = useState<string | null>(null)
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
      const res = await fetch('/api/proveedores/cumplimiento')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Error')
      const d = await res.json()
      setProductos(d.productos)
      setResumen(d.resumen_global)
    } catch (e: any) {
      setError(e.message ?? 'Error desconocido')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  function actualizarProducto(catalogoId: number, pvp: number | null) {
    setProductos(prev =>
      prev.map(p => p.catalogo_id !== catalogoId ? p : { ...p, pvp_sugerido: pvp })
    )
  }

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span className="text-sm">Analizando cumplimiento…</span>
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
        <p className="text-sm text-amber-700">
          {esMigracion
            ? 'Ejecuta la migración 004 en el SQL Editor de Supabase para activar esta funcionalidad.'
            : error}
        </p>
        {!esMigracion && (
          <button
            onClick={cargar}
            className="mt-4 text-xs text-amber-800 underline"
          >
            Reintentar
          </button>
        )}
      </div>
    )
  }

  const total = resumen.total_ok + resumen.total_alto + resumen.total_bajo + resumen.total_sin_datos
  const pctOk = total > 0 ? Math.round(resumen.total_ok / total * 100) : 0

  return (
    <div className="space-y-6">

      {/* Resumen global */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {([
          { key: 'total_ok',             label: 'En rango',         color: 'emerald', icon: CheckCircle2 },
          { key: 'total_alto',           label: 'Sobre el PVP',     color: 'amber',   icon: AlertTriangle },
          { key: 'total_bajo',           label: 'Bajo el PVP',      color: 'red',     icon: TrendingDown },
          { key: 'total_sin_datos',      label: 'Sin datos',        color: 'slate',   icon: HelpCircle   },
        ] as const).map(({ key, label, color, icon: Icono }) => {
          const val = resumen[key as keyof ResumenGlobal]
          const colorMap = {
            emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600', val: 'text-emerald-700' },
            amber:   { bg: 'bg-amber-50',   icon: 'text-amber-600',   val: 'text-amber-700'   },
            red:     { bg: 'bg-red-50',     icon: 'text-red-600',     val: 'text-red-700'     },
            slate:   { bg: 'bg-slate-50',   icon: 'text-slate-500',   val: 'text-slate-700'   },
          }[color]
          return (
            <div key={key} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-start gap-3">
              <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', colorMap.bg)}>
                <Icono className={clsx('w-4 h-4', colorMap.icon)} />
              </div>
              <div>
                <p className="text-xs text-slate-500">{label}</p>
                <p className={clsx('text-xl font-bold', colorMap.val)}>{val}</p>
                <p className="text-xs text-slate-400">precios monitoreados</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Barra de cumplimiento global */}
      {total > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-slate-700">Cumplimiento global de PVP</p>
            <p className="text-sm font-bold text-emerald-700">{pctOk}%</p>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden flex">
            {resumen.total_ok > 0 && (
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${resumen.total_ok / total * 100}%` }} />
            )}
            {resumen.total_alto > 0 && (
              <div className="h-full bg-amber-400 transition-all" style={{ width: `${resumen.total_alto / total * 100}%` }} />
            )}
            {resumen.total_bajo > 0 && (
              <div className="h-full bg-red-400 transition-all" style={{ width: `${resumen.total_bajo / total * 100}%` }} />
            )}
          </div>
          <div className="flex gap-4 mt-2 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-full inline-block" /> En rango</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-400 rounded-full inline-block" /> Sobre PVP</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-400 rounded-full inline-block" /> Bajo PVP</span>
          </div>
        </div>
      )}

      {/* Lista de productos */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700">Productos ({productos.length})</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => descargar('cumplimiento')}
              disabled={cargandoExport || productos.length === 0}
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

        {productos.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center">
            <Package className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-slate-500 text-sm">No hay productos registrados para tus marcas.</p>
          </div>
        ) : (
          <div>
            {productos.map(p => (
              <FilaProducto key={p.catalogo_id} prod={p} onActualizar={actualizarProducto} />
            ))}
          </div>
        )}
      </div>

    </div>
  )
}

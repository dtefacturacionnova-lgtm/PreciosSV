'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  CheckCircle2, AlertTriangle, TrendingDown, HelpCircle,
  RefreshCw, Package, Pencil, X, Check, ChevronDown, ChevronUp,
} from 'lucide-react'
import clsx from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

type Estado = 'ok' | 'alto' | 'bajo' | 'sin_referencia'

interface TiendaCumplimiento {
  supermercado:      string
  key:               string
  color:             string
  precio_normal:     number
  precio_oferta:     number | null
  en_oferta:         boolean
  precio_efectivo:   number
  precio_referencia: number | null
  desviacion_pct:    number | null
  estado:            Estado
}

interface ProductoCumplimiento {
  id:              number
  nombre:          string
  marca:           string | null
  imagen_url:      string | null
  precio_sugerido: number | null
  precio_promo:    number | null
  en_promocion:    boolean
  tiendas:         TiendaCumplimiento[]
  resumen:         Record<Estado, number>
}

interface ResumenGlobal {
  total_ok:              number
  total_alto:            number
  total_bajo:            number
  total_sin_referencia:  number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ESTADO_META: Record<Estado, { label: string; color: string; bg: string; icon: typeof CheckCircle2 }> = {
  ok:              { label: 'En rango',          color: 'text-emerald-700', bg: 'bg-emerald-100', icon: CheckCircle2 },
  alto:            { label: 'Sobre el PVP',      color: 'text-amber-700',  bg: 'bg-amber-100',   icon: AlertTriangle },
  bajo:            { label: 'Bajo el PVP',       color: 'text-red-700',    bg: 'bg-red-100',     icon: TrendingDown },
  sin_referencia:  { label: 'Sin PVP registrado',color: 'text-slate-500',  bg: 'bg-slate-100',   icon: HelpCircle   },
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
  productoId:      number
  precioSugerido:  number | null
  precioPromo:     number | null
  enPromocion:     boolean
  onGuardado:      (ps: number | null, pp: number | null, ep: boolean) => void
  onCancelar:      () => void
}

function FormPVP({ productoId, precioSugerido, precioPromo, enPromocion, onGuardado, onCancelar }: FormPVPProps) {
  const [ps, setPs] = useState(precioSugerido?.toString() ?? '')
  const [pp, setPp] = useState(precioPromo?.toString() ?? '')
  const [ep, setEp] = useState(enPromocion)
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState('')

  async function guardar() {
    const psNum = ps.trim() ? parseFloat(ps) : null
    const ppNum = pp.trim() ? parseFloat(pp) : null
    if (ps.trim() && isNaN(psNum!)) { setErr('Precio inválido'); return }
    setGuardando(true)
    setErr('')
    try {
      const res = await fetch('/api/proveedores/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referencia: {
            producto_id:     productoId,
            precio_sugerido: psNum,
            precio_promo:    ppNum,
            en_promocion:    ep,
          },
        }),
      })
      if (!res.ok) throw new Error()
      onGuardado(psNum, ppNum, ep)
    } catch {
      setErr('Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="mt-2 p-3 bg-blue-50 border border-blue-100 rounded-xl text-sm space-y-2">
      <p className="font-medium text-blue-800 text-xs mb-1">Precio de referencia del proveedor</p>

      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-0.5">PVP sugerido</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={ps}
              onChange={e => setPs(e.target.value)}
              placeholder="0.00"
              className="w-28 pl-5 pr-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-500 mb-0.5">Precio promo</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={pp}
              onChange={e => setPp(e.target.value)}
              placeholder="0.00"
              className="w-28 pl-5 pr-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        </div>

        <label className="flex items-center gap-1.5 cursor-pointer pb-1">
          <input
            type="checkbox"
            checked={ep}
            onChange={e => setEp(e.target.checked)}
            className="w-3.5 h-3.5 accent-blue-600"
          />
          <span className="text-xs text-slate-600">Promoción activa</span>
        </label>
      </div>

      {err && <p className="text-xs text-red-600">{err}</p>}

      <div className="flex gap-2 pt-1">
        <button
          onClick={guardar}
          disabled={guardando}
          className="inline-flex items-center gap-1 bg-blue-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {guardando ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          Guardar
        </button>
        <button
          onClick={onCancelar}
          className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5"
        >
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
  onActualizar: (id: number, ps: number | null, pp: number | null, ep: boolean) => void
}) {
  const [expandido, setExpandido] = useState(false)
  const [editando,  setEditando]  = useState(false)

  // Icono de estado global del producto
  const hayProblemas = prod.resumen.alto > 0 || prod.resumen.bajo > 0
  const hayOk        = prod.resumen.ok > 0
  const sinRef       = !prod.precio_sugerido

  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden mb-2">
      {/* Cabecera de la fila */}
      <div
        className="flex items-center gap-3 p-3 bg-white hover:bg-slate-50/60 cursor-pointer transition-colors"
        onClick={() => setExpandido(v => !v)}
      >
        {/* Imagen */}
        <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
          {prod.imagen_url ? (
            <img src={prod.imagen_url} alt={prod.nombre} className="max-h-7 max-w-7 object-contain" />
          ) : (
            <Package className="w-4 h-4 text-slate-400" />
          )}
        </div>

        {/* Nombre */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">{prod.nombre}</p>
          <p className="text-xs text-slate-400">{prod.marca}</p>
        </div>

        {/* PVP sugerido */}
        <div
          className="text-right mr-2 flex-shrink-0"
          onClick={e => { e.stopPropagation(); setExpandido(true); setEditando(true) }}
        >
          {prod.precio_sugerido ? (
            <div className="group flex items-center gap-1 cursor-pointer">
              <div>
                <p className="text-xs text-slate-400">PVP ref.</p>
                <p className="text-sm font-bold text-slate-700">
                  ${prod.precio_sugerido.toFixed(2)}
                  {prod.en_promocion && prod.precio_promo && (
                    <span className="ml-1 text-xs font-normal text-blue-600">
                      (promo ${prod.precio_promo.toFixed(2)})
                    </span>
                  )}
                </p>
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
            <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">
              {prod.resumen.ok} ✓
            </span>
          )}
          {prod.resumen.alto > 0 && (
            <span className="text-xs font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
              {prod.resumen.alto} ↑
            </span>
          )}
          {prod.resumen.bajo > 0 && (
            <span className="text-xs font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
              {prod.resumen.bajo} ↓
            </span>
          )}
          {sinRef && (
            <span className="text-xs font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
              Sin PVP
            </span>
          )}
        </div>

        {/* Chevron */}
        <div className="text-slate-300 flex-shrink-0">
          {expandido ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {/* Detalle expandido */}
      {expandido && (
        <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-3">

          {/* Formulario de precio */}
          {editando ? (
            <FormPVP
              productoId={prod.id}
              precioSugerido={prod.precio_sugerido}
              precioPromo={prod.precio_promo}
              enPromocion={prod.en_promocion}
              onGuardado={(ps, pp, ep) => {
                onActualizar(prod.id, ps, pp, ep)
                setEditando(false)
              }}
              onCancelar={() => setEditando(false)}
            />
          ) : (
            <button
              onClick={() => setEditando(true)}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 mb-3"
            >
              <Pencil className="w-3 h-3" />
              {prod.precio_sugerido ? 'Editar precio de referencia' : 'Registrar precio de referencia'}
            </button>
          )}

          {/* Precios por tienda */}
          {prod.tiendas.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {prod.tiendas.map(t => {
                const m = ESTADO_META[t.estado]
                return (
                  <div
                    key={t.key}
                    className={clsx(
                      'flex flex-col gap-0.5 bg-white border rounded-xl px-3 py-2 min-w-[120px]',
                      t.estado === 'ok'    ? 'border-emerald-200' :
                      t.estado === 'alto'  ? 'border-amber-200'   :
                      t.estado === 'bajo'  ? 'border-red-200'     :
                                             'border-slate-100'
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
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic">Sin precios registrados en supermercados.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function CumplimientoPrecios() {
  const [productos, setProductos] = useState<ProductoCumplimiento[]>([])
  const [resumen,   setResumen]   = useState<ResumenGlobal>({ total_ok: 0, total_alto: 0, total_bajo: 0, total_sin_referencia: 0 })
  const [cargando,  setCargando]  = useState(true)
  const [error,     setError]     = useState<string | null>(null)

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

  function actualizarProducto(id: number, ps: number | null, pp: number | null, ep: boolean) {
    setProductos(prev =>
      prev.map(p => p.id !== id ? p : { ...p, precio_sugerido: ps, precio_promo: pp, en_promocion: ep })
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

  const total = resumen.total_ok + resumen.total_alto + resumen.total_bajo + resumen.total_sin_referencia
  const pctOk = total > 0 ? Math.round(resumen.total_ok / total * 100) : 0

  return (
    <div className="space-y-6">

      {/* Resumen global */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {([
          { key: 'total_ok',             label: 'En rango',         color: 'emerald', icon: CheckCircle2 },
          { key: 'total_alto',           label: 'Sobre el PVP',     color: 'amber',   icon: AlertTriangle },
          { key: 'total_bajo',           label: 'Bajo el PVP',      color: 'red',     icon: TrendingDown },
          { key: 'total_sin_referencia', label: 'Sin PVP ref.',     color: 'slate',   icon: HelpCircle   },
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
          <button
            onClick={cargar}
            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Actualizar
          </button>
        </div>

        {productos.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center">
            <Package className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-slate-500 text-sm">No hay productos registrados para tus marcas.</p>
          </div>
        ) : (
          <div>
            {productos.map(p => (
              <FilaProducto key={p.id} prod={p} onActualizar={actualizarProducto} />
            ))}
          </div>
        )}
      </div>

    </div>
  )
}

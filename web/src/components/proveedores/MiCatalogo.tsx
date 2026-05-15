'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Plus, Package, Pencil, Trash2, ChevronDown, ChevronUp,
  RefreshCw, X, Check, AlertTriangle, Barcode, Users,
  Star, ArrowUpDown, Link2, Link2Off, ShoppingCart,
  TrendingUp, TrendingDown, Minus, ExternalLink,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoRelacion = 'SUSTITUTO_DIRECTO' | 'ALTERNATIVA_PREMIUM' | 'ALTERNATIVA_ECONOMICA'
type Prioridad = 1 | 2 | 3

interface Competidor {
  id:                   number
  competidor_nombre:    string
  competidor_marca:     string
  competidor_ean_13:    string | null
  competidor_upc_12:    string | null
  tipo_relacion:        TipoRelacion
  factor_conversion:    number
  misma_presentacion:   boolean
  prioridad:            Prioridad
  notas:                string | null
}

interface Producto {
  id:               number
  nombre:           string
  marca:            string
  presentacion:     string | null
  gramaje:          number | null
  unidad:           string | null
  ean_13:           string | null
  upc_12:           string | null
  codigo_interno:   string | null
  pvp_sugerido:     number | null
  notas:            string | null
  activo:           boolean
  competidores_count: number
  producto_id:      number | null   // null = sin enlace al sistema de precios
}

// ─── Tipos para el panel de precios ──────────────────────────────────────────

interface PrecioSuper {
  supermercado_key:    string
  supermercado_nombre: string
  logo_url:            string | null
  nombre_local:        string | null
  url_producto:        string | null
  precio_normal:       number
  precio_oferta:       number | null
  en_oferta:           boolean
  descuento_pct:       number | null
  condicion_oferta:    string | null
  disponible:          boolean
  fecha_hora:          string
}

interface DatoComparativa {
  es_propio:           boolean
  etiqueta:            string
  marca:               string
  tipo_relacion:       string | null
  factor_conversion:   number
  supermercado_key:    string
  supermercado_nombre: string
  precio_normal:       number
  precio_oferta:       number | null
  en_oferta:           boolean
  precio_normalizado:  number
  fecha_hora:          string
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const PRESENTACIONES = ['Barra', 'Botella', 'Caja', 'Bolsa', 'Spray', 'Sachet', 'Lata', 'Tubo', 'Frasco', 'Paquete', 'Unidad']
const UNIDADES       = ['g', 'kg', 'ml', 'L', 'un', 'oz']
const RELACION_LABEL: Record<TipoRelacion, string> = {
  SUSTITUTO_DIRECTO:    'Sustituto directo',
  ALTERNATIVA_PREMIUM:  'Alternativa premium',
  ALTERNATIVA_ECONOMICA: 'Alternativa económica',
}
const RELACION_COLOR: Record<TipoRelacion, string> = {
  SUSTITUTO_DIRECTO:    'bg-blue-100 text-blue-700',
  ALTERNATIVA_PREMIUM:  'bg-purple-100 text-purple-700',
  ALTERNATIVA_ECONOMICA: 'bg-green-100 text-green-700',
}
const PRIORIDAD_LABEL: Record<Prioridad, string> = { 1: 'Alta', 2: 'Media', 3: 'Baja' }
const PRIORIDAD_COLOR: Record<Prioridad, string> = {
  1: 'text-red-600', 2: 'text-amber-600', 3: 'text-slate-500',
}

// ─── Formulario de producto ───────────────────────────────────────────────────

interface ProductoForm {
  nombre: string; marca: string; presentacion: string; gramaje: string
  unidad: string; ean_13: string; upc_12: string; codigo_interno: string
  pvp_sugerido: string; notas: string
}

const PRODUCTO_VACIO: ProductoForm = {
  nombre: '', marca: '', presentacion: '', gramaje: '',
  unidad: 'g', ean_13: '', upc_12: '', codigo_interno: '',
  pvp_sugerido: '', notas: '',
}

// ─── Formulario de competidor ─────────────────────────────────────────────────

interface CompetidorForm {
  competidor_nombre: string; competidor_marca: string
  competidor_ean_13: string; competidor_upc_12: string
  tipo_relacion: TipoRelacion; factor_conversion: string
  misma_presentacion: boolean; prioridad: string; notas: string
}

const COMPETIDOR_VACIO: CompetidorForm = {
  competidor_nombre: '', competidor_marca: '', competidor_ean_13: '',
  competidor_upc_12: '', tipo_relacion: 'SUSTITUTO_DIRECTO',
  factor_conversion: '1', misma_presentacion: true, prioridad: '2', notas: '',
}

// ─── Modal genérico ───────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
          <h3 className="font-semibold text-slate-800 text-base">{title}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

// ─── Campo de formulario ──────────────────────────────────────────────────────

function Campo({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  )
}

const inputCls = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
const selectCls = inputCls

// ─── Formulario Producto Modal ────────────────────────────────────────────────

function ModalProducto({ producto, onClose, onSaved }: {
  producto: Producto | null; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState<ProductoForm>(
    producto
      ? {
          nombre: producto.nombre, marca: producto.marca,
          presentacion: producto.presentacion ?? '', gramaje: producto.gramaje?.toString() ?? '',
          unidad: producto.unidad ?? 'g', ean_13: producto.ean_13 ?? '',
          upc_12: producto.upc_12 ?? '', codigo_interno: producto.codigo_interno ?? '',
          pvp_sugerido: producto.pvp_sugerido?.toString() ?? '', notas: producto.notas ?? '',
        }
      : PRODUCTO_VACIO
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof ProductoForm, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function guardar() {
    if (!form.nombre.trim() || !form.marca.trim()) {
      setError('Nombre y marca son obligatorios')
      return
    }
    setGuardando(true); setError(null)
    const body = {
      nombre: form.nombre.trim(),
      marca: form.marca.trim(),
      presentacion: form.presentacion || null,
      gramaje: form.gramaje ? +form.gramaje : null,
      unidad: form.unidad || null,
      ean_13: form.ean_13 || null,
      upc_12: form.upc_12 || null,
      codigo_interno: form.codigo_interno || null,
      pvp_sugerido: form.pvp_sugerido ? +form.pvp_sugerido : null,
      notas: form.notas || null,
    }
    const url = producto ? `/api/proveedores/catalogo/${producto.id}` : '/api/proveedores/catalogo'
    const method = producto ? 'PATCH' : 'POST'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) {
      const d = await res.json()
      setError(d.error ?? 'Error al guardar')
    } else {
      onSaved()
    }
    setGuardando(false)
  }

  return (
    <Modal title={producto ? 'Editar producto' : 'Agregar producto'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-4">
        <div className="col-span-2">
          <Campo label="Nombre del producto *">
            <input className={inputCls} value={form.nombre} onChange={e => set('nombre', e.target.value)} placeholder="Ej: Jabón Dove Original" />
          </Campo>
        </div>
        <Campo label="Marca *">
          <input className={inputCls} value={form.marca} onChange={e => set('marca', e.target.value)} placeholder="Ej: Dove" />
        </Campo>
        <Campo label="Código interno (SKU)">
          <input className={inputCls} value={form.codigo_interno} onChange={e => set('codigo_interno', e.target.value)} placeholder="Ej: DOV-001" />
        </Campo>
        <Campo label="Presentación">
          <select className={selectCls} value={form.presentacion} onChange={e => set('presentacion', e.target.value)}>
            <option value="">Seleccionar…</option>
            {PRESENTACIONES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Campo>
        <div className="flex gap-2">
          <Campo label="Cantidad">
            <input className={inputCls} type="number" min="0" step="any" value={form.gramaje} onChange={e => set('gramaje', e.target.value)} placeholder="Ej: 90" />
          </Campo>
          <Campo label="Unidad">
            <select className={selectCls} value={form.unidad} onChange={e => set('unidad', e.target.value)}>
              {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </Campo>
        </div>
        <Campo label="EAN-13" hint="Código de barras de 13 dígitos">
          <input className={inputCls} value={form.ean_13} onChange={e => set('ean_13', e.target.value)} placeholder="0000000000000" maxLength={13} />
        </Campo>
        <Campo label="UPC-12" hint="Código de barras de 12 dígitos">
          <input className={inputCls} value={form.upc_12} onChange={e => set('upc_12', e.target.value)} placeholder="000000000000" maxLength={12} />
        </Campo>
        <div className="col-span-2">
          <Campo label="PVP Sugerido ($)" hint="Precio de venta al público sugerido">
            <input className={inputCls} type="number" min="0" step="0.01" value={form.pvp_sugerido} onChange={e => set('pvp_sugerido', e.target.value)} placeholder="1.25" />
          </Campo>
        </div>
        <div className="col-span-2">
          <Campo label="Notas internas">
            <textarea className={inputCls} rows={2} value={form.notas} onChange={e => set('notas', e.target.value)} placeholder="Observaciones sobre el producto…" />
          </Campo>
        </div>
      </div>
      {error && <p className="text-xs text-red-600 mb-3 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{error}</p>}
      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancelar</button>
        <button onClick={guardar} disabled={guardando} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-1.5">
          {guardando ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  )
}

// ─── Formulario Competidor Modal ──────────────────────────────────────────────

function ModalCompetidor({ productoId, competidor, onClose, onSaved }: {
  productoId: number; competidor: Competidor | null; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState<CompetidorForm>(
    competidor
      ? {
          competidor_nombre: competidor.competidor_nombre,
          competidor_marca: competidor.competidor_marca,
          competidor_ean_13: competidor.competidor_ean_13 ?? '',
          competidor_upc_12: competidor.competidor_upc_12 ?? '',
          tipo_relacion: competidor.tipo_relacion,
          factor_conversion: competidor.factor_conversion.toString(),
          misma_presentacion: competidor.misma_presentacion,
          prioridad: competidor.prioridad.toString(),
          notas: competidor.notas ?? '',
        }
      : COMPETIDOR_VACIO
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof CompetidorForm>(k: K, v: CompetidorForm[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  async function guardar() {
    if (!form.competidor_nombre.trim() || !form.competidor_marca.trim()) {
      setError('Nombre y marca del competidor son obligatorios')
      return
    }
    setGuardando(true); setError(null)
    const body = {
      competidor_nombre: form.competidor_nombre.trim(),
      competidor_marca: form.competidor_marca.trim(),
      competidor_ean_13: form.competidor_ean_13 || null,
      competidor_upc_12: form.competidor_upc_12 || null,
      tipo_relacion: form.tipo_relacion,
      factor_conversion: +form.factor_conversion || 1,
      misma_presentacion: form.misma_presentacion,
      prioridad: +form.prioridad || 2,
      notas: form.notas || null,
    }
    const url = competidor
      ? `/api/proveedores/catalogo/${productoId}/competidores/${competidor.id}`
      : `/api/proveedores/catalogo/${productoId}/competidores`
    const method = competidor ? 'PATCH' : 'POST'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) {
      const d = await res.json()
      setError(d.error ?? 'Error al guardar')
    } else {
      onSaved()
    }
    setGuardando(false)
  }

  return (
    <Modal title={competidor ? 'Editar competidor' : 'Agregar competidor'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-4">
        <Campo label="Nombre del producto competidor *">
          <input className={inputCls} value={form.competidor_nombre} onChange={e => set('competidor_nombre', e.target.value)} placeholder="Ej: Jabón Palmolive Naturals 90g" />
        </Campo>
        <Campo label="Marca *">
          <input className={inputCls} value={form.competidor_marca} onChange={e => set('competidor_marca', e.target.value)} placeholder="Ej: Palmolive" />
        </Campo>
        <Campo label="EAN-13 competidor" hint="Matching exacto en scrapers">
          <input className={inputCls} value={form.competidor_ean_13} onChange={e => set('competidor_ean_13', e.target.value)} placeholder="0000000000000" maxLength={13} />
        </Campo>
        <Campo label="UPC-12 competidor">
          <input className={inputCls} value={form.competidor_upc_12} onChange={e => set('competidor_upc_12', e.target.value)} placeholder="000000000000" maxLength={12} />
        </Campo>
        <div className="col-span-2">
          <Campo label="Tipo de relación">
            <select className={selectCls} value={form.tipo_relacion} onChange={e => set('tipo_relacion', e.target.value as TipoRelacion)}>
              <option value="SUSTITUTO_DIRECTO">Sustituto directo (mismo uso, mismo segmento)</option>
              <option value="ALTERNATIVA_PREMIUM">Alternativa premium (mayor precio/calidad)</option>
              <option value="ALTERNATIVA_ECONOMICA">Alternativa económica (menor precio)</option>
            </select>
          </Campo>
        </div>
        <Campo label="¿Misma presentación/tamaño?">
          <div className="flex gap-3 mt-1">
            {[true, false].map(v => (
              <label key={String(v)} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" checked={form.misma_presentacion === v} onChange={() => set('misma_presentacion', v)} className="accent-blue-600" />
                {v ? 'Sí' : 'No (tamaños distintos)'}
              </label>
            ))}
          </div>
        </Campo>
        <Campo label="Factor de conversión" hint={form.misma_presentacion ? 'Mantener en 1.0' : 'Ej: mi 90g vs competidor 100g → 0.90'}>
          <input className={inputCls} type="number" min="0.01" step="0.01" value={form.factor_conversion} onChange={e => set('factor_conversion', e.target.value)} disabled={form.misma_presentacion} />
        </Campo>
        <Campo label="Prioridad de seguimiento">
          <select className={selectCls} value={form.prioridad} onChange={e => set('prioridad', e.target.value)}>
            <option value="1">⬆ Alta — seguimiento prioritario</option>
            <option value="2">➡ Media — seguimiento regular</option>
            <option value="3">⬇ Baja — seguimiento ocasional</option>
          </select>
        </Campo>
        <div className="col-span-2">
          <Campo label="Notas">
            <textarea className={inputCls} rows={2} value={form.notas} onChange={e => set('notas', e.target.value)} placeholder="Ej: versión con hidratante, diferente envase…" />
          </Campo>
        </div>
      </div>
      {error && <p className="text-xs text-red-600 mb-3 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{error}</p>}
      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancelar</button>
        <button onClick={guardar} disabled={guardando} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-1.5">
          {guardando ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  )
}

// ─── Fila de competidor ───────────────────────────────────────────────────────

function FilaCompetidor({ c, productoId, onActualizar }: {
  c: Competidor; productoId: number; onActualizar: () => void
}) {
  const [editando, setEditando]   = useState(false)
  const [borrando, setBorrando]   = useState(false)

  async function eliminar() {
    if (!confirm(`¿Eliminar "${c.competidor_nombre}"?`)) return
    setBorrando(true)
    await fetch(`/api/proveedores/catalogo/${productoId}/competidores/${c.id}`, { method: 'DELETE' })
    onActualizar()
  }

  return (
    <>
      {editando && (
        <ModalCompetidor
          productoId={productoId}
          competidor={c}
          onClose={() => setEditando(false)}
          onSaved={() => { setEditando(false); onActualizar() }}
        />
      )}
      <div className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${PRIORIDAD_COLOR[c.prioridad]}`}>
            {PRIORIDAD_LABEL[c.prioridad]}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800 truncate">{c.competidor_nombre}</p>
            <p className="text-xs text-slate-400">{c.competidor_marca}{c.competidor_ean_13 ? ` · EAN: ${c.competidor_ean_13}` : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full ${RELACION_COLOR[c.tipo_relacion]}`}>
            {RELACION_LABEL[c.tipo_relacion]}
          </span>
          {!c.misma_presentacion && (
            <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
              ×{c.factor_conversion}
            </span>
          )}
          <button onClick={() => setEditando(true)} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={eliminar} disabled={borrando} className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-500 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </>
  )
}

// ─── Panel de competidores expandido ─────────────────────────────────────────

function PanelCompetidores({ productoId }: { productoId: number }) {
  const [competidores, setCompetidores] = useState<Competidor[]>([])
  const [cargando,     setCargando]     = useState(true)
  const [agregando,    setAgregando]    = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const res = await fetch(`/api/proveedores/catalogo/${productoId}/competidores`)
    if (res.ok) setCompetidores(await res.json())
    setCargando(false)
  }, [productoId])

  useEffect(() => { cargar() }, [cargar])

  return (
    <div className="bg-slate-50 rounded-xl p-4 mt-2 border border-slate-100">
      {agregando && (
        <ModalCompetidor
          productoId={productoId}
          competidor={null}
          onClose={() => setAgregando(false)}
          onSaved={() => { setAgregando(false); cargar() }}
        />
      )}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" /> Productos competidores equivalentes
        </p>
        <button
          onClick={() => setAgregando(true)}
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
        >
          <Plus className="w-3.5 h-3.5" /> Agregar
        </button>
      </div>
      {cargando ? (
        <p className="text-xs text-slate-400 py-2">Cargando…</p>
      ) : competidores.length === 0 ? (
        <p className="text-xs text-slate-400 py-2 text-center">
          Sin competidores registrados. Agrégalos para activar el análisis comparativo.
        </p>
      ) : (
        competidores.map(c => (
          <FilaCompetidor key={c.id} c={c} productoId={productoId} onActualizar={cargar} />
        ))
      )}
    </div>
  )
}

// ─── Panel de precios en supermercados ────────────────────────────────────────

function PanelPrecios({ productoId, pvpSugerido }: { productoId: number; pvpSugerido: number | null }) {
  const [estado, setEstado] = useState<{
    cargando: boolean
    enlazado: boolean
    precios: PrecioSuper[]
    mensaje?: string
  }>({ cargando: true, enlazado: false, precios: [] })

  useEffect(() => {
    fetch(`/api/proveedores/catalogo/${productoId}/precios`)
      .then(r => r.json())
      .then(d => setEstado({ cargando: false, enlazado: d.enlazado, precios: d.precios ?? [], mensaje: d.mensaje }))
      .catch(() => setEstado({ cargando: false, enlazado: false, precios: [], mensaje: 'Error de conexión' }))
  }, [productoId])

  if (estado.cargando) {
    return (
      <div className="bg-slate-50 rounded-xl p-4 mt-2 border border-slate-100 flex items-center gap-2 text-slate-400 text-xs">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Cargando precios…
      </div>
    )
  }

  if (!estado.enlazado || estado.precios.length === 0) {
    return (
      <div className="bg-slate-50 rounded-xl p-4 mt-2 border border-slate-100">
        <div className="flex items-center gap-2 mb-2">
          <ShoppingCart className="w-3.5 h-3.5 text-slate-400" />
          <p className="text-xs font-semibold text-slate-600">Precios en supermercados</p>
        </div>
        <p className="text-xs text-slate-400 text-center py-4">
          {estado.mensaje ?? 'Sin datos disponibles.'}
        </p>
        {!estado.enlazado && (
          <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 flex items-center gap-1.5">
            <Link2Off className="w-3.5 h-3.5 flex-shrink-0" />
            Agrega un EAN-13 al producto para activar el enlace automático con los scrapers.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="bg-slate-50 rounded-xl p-4 mt-2 border border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
          <ShoppingCart className="w-3.5 h-3.5" /> Precios en supermercados
        </p>
        <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
          <Link2 className="w-3 h-3" /> Enlazado
        </span>
      </div>
      <div className="space-y-2">
        {estado.precios.map(pr => {
          const precio = pr.en_oferta ? pr.precio_oferta! : pr.precio_normal
          const vsPvp = pvpSugerido
            ? Math.round(((precio - pvpSugerido) / pvpSugerido) * 100)
            : null

          return (
            <div key={pr.supermercado_key} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-slate-100">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <ShoppingCart className="w-3 h-3 text-slate-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-700 truncate">{pr.supermercado_nombre}</p>
                  {pr.nombre_local && (
                    <p className="text-[10px] text-slate-400 truncate">{pr.nombre_local}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                {pr.en_oferta && (
                  <span className="text-[10px] text-slate-400 line-through">${pr.precio_normal.toFixed(2)}</span>
                )}
                <span className={`text-sm font-semibold ${pr.en_oferta ? 'text-emerald-600' : 'text-slate-800'}`}>
                  ${precio.toFixed(2)}
                </span>
                {pr.en_oferta && pr.descuento_pct && (
                  <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">
                    -{pr.descuento_pct.toFixed(0)}%
                  </span>
                )}
                {vsPvp !== null && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${
                    vsPvp <= 0 ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'
                  }`}>
                    {vsPvp <= 0 ? <TrendingDown className="w-2.5 h-2.5" /> : <TrendingUp className="w-2.5 h-2.5" />}
                    {vsPvp > 0 ? '+' : ''}{vsPvp}% vs PVP
                  </span>
                )}
                {pr.url_producto && (
                  <a href={pr.url_producto} target="_blank" rel="noopener noreferrer"
                     className="p-1 hover:bg-slate-100 rounded text-slate-300 hover:text-blue-500 transition-colors">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-[10px] text-slate-300 mt-2 text-right">
        Última actualización: {new Date(estado.precios[0].fecha_hora).toLocaleDateString('es-SV')}
      </p>
    </div>
  )
}

// ─── Fila de producto ─────────────────────────────────────────────────────────

function FilaProducto({ p, onActualizar }: { p: Producto; onActualizar: () => void }) {
  const [panel,    setPanel]    = useState<'competidores' | 'precios' | null>(null)
  const [editando, setEditando] = useState(false)
  const [borrando, setBorrando] = useState(false)

  const togglePanel = (nombre: 'competidores' | 'precios') =>
    setPanel(prev => (prev === nombre ? null : nombre))

  async function eliminar() {
    if (!confirm(`¿Desactivar "${p.nombre}"? Puedes reactivarlo luego.`)) return
    setBorrando(true)
    await fetch(`/api/proveedores/catalogo/${p.id}`, { method: 'DELETE' })
    onActualizar()
  }

  const descripcion = [
    p.presentacion,
    p.gramaje ? `${p.gramaje}${p.unidad ?? ''}` : null,
  ].filter(Boolean).join(' ')

  const enlazado = !!p.producto_id

  return (
    <>
      {editando && (
        <ModalProducto
          producto={p}
          onClose={() => setEditando(false)}
          onSaved={() => { setEditando(false); onActualizar() }}
        />
      )}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        {/* Fila principal */}
        <div className="flex items-center gap-3 p-4">
          {/* Icono + badge de enlace */}
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
              <Package className="w-4 h-4 text-blue-500" />
            </div>
            {/* Indicador de enlace al sistema de precios */}
            <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center
              ${enlazado ? 'bg-emerald-500' : 'bg-slate-300'}`}
              title={enlazado ? 'Enlazado al sistema de precios' : 'Sin enlace — agrega EAN para enlazar'}
            >
              {enlazado
                ? <Link2 className="w-2.5 h-2.5 text-white" />
                : <Link2Off className="w-2.5 h-2.5 text-white" />
              }
            </div>
          </div>

          {/* Info producto */}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-slate-800 text-sm truncate">{p.nombre}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs text-blue-600 font-medium">{p.marca}</span>
              {descripcion && <span className="text-xs text-slate-400">{descripcion}</span>}
              {p.ean_13 && (
                <span className="text-xs text-slate-400 flex items-center gap-0.5">
                  <Barcode className="w-3 h-3" />{p.ean_13}
                </span>
              )}
              {p.pvp_sugerido && (
                <span className="text-xs bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">
                  PVP ${p.pvp_sugerido.toFixed(2)}
                </span>
              )}
            </div>
          </div>

          {/* Botones de panel */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Precios en supermercados */}
            <button
              onClick={() => togglePanel('precios')}
              title="Ver precios en supermercados"
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors
                ${panel === 'precios'
                  ? 'bg-indigo-600 text-white'
                  : enlazado
                    ? 'text-indigo-600 hover:bg-indigo-50'
                    : 'text-slate-300 hover:bg-slate-50'
                }`}
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              {panel === 'precios' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {/* Competidores */}
            <button
              onClick={() => togglePanel('competidores')}
              className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg transition-colors
                ${panel === 'competidores'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50'
                }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span className="font-medium">{p.competidores_count}</span>
              {panel === 'competidores' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {/* Editar / Eliminar */}
            <button
              onClick={() => setEditando(true)}
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
              title="Editar"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={eliminar}
              disabled={borrando}
              className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500 transition-colors"
              title="Desactivar"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Paneles expandibles */}
        {panel === 'precios' && (
          <div className="px-4 pb-4">
            <PanelPrecios productoId={p.id} pvpSugerido={p.pvp_sugerido} />
          </div>
        )}
        {panel === 'competidores' && (
          <div className="px-4 pb-4">
            <PanelCompetidores productoId={p.id} />
          </div>
        )}
      </div>
    </>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function MiCatalogo() {
  const [productos,  setProductos]  = useState<Producto[]>([])
  const [cargando,   setCargando]   = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [agregando,  setAgregando]  = useState(false)
  const [busqueda,   setBusqueda]   = useState('')

  const cargar = useCallback(async () => {
    setCargando(true); setError(null)
    try {
      const res = await fetch('/api/proveedores/catalogo')
      const data = await res.json()
      if (res.ok) setProductos(Array.isArray(data) ? data : (data.productos ?? []))
      else setError(data.error ?? 'No se pudo cargar el catálogo')
    } catch {
      setError('Error de conexión')
    }
    setCargando(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const filtrados = productos.filter(p =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    p.marca.toLowerCase().includes(busqueda.toLowerCase()) ||
    (p.ean_13 ?? '').includes(busqueda) ||
    (p.upc_12 ?? '').includes(busqueda)
  )

  const totalCompetidores = productos.reduce((s, p) => s + p.competidores_count, 0)

  return (
    <>
      {agregando && (
        <ModalProducto
          producto={null}
          onClose={() => setAgregando(false)}
          onSaved={() => { setAgregando(false); cargar() }}
        />
      )}

      {/* Métricas rápidas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Productos registrados', valor: productos.length,                                        color: 'text-blue-600',   Icon: Package },
          { label: 'Con EAN registrado',    valor: productos.filter(p => p.ean_13).length,                  color: 'text-indigo-600', Icon: Barcode },
          { label: 'Enlazados al sistema',  valor: productos.filter(p => p.producto_id).length,             color: 'text-emerald-600',Icon: Link2 },
          { label: 'Competidores mapeados', valor: totalCompetidores,                                       color: 'text-purple-600', Icon: Users },
        ].map(m => (
          <div key={m.label} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
            <m.Icon className={`w-4 h-4 mx-auto mb-1 ${m.color} opacity-60`} />
            <p className={`text-2xl font-bold ${m.color}`}>{m.valor}</p>
            <p className="text-xs text-slate-500 mt-0.5">{m.label}</p>
          </div>
        ))}
      </div>

      {/* Barra de acciones */}
      <div className="flex items-center gap-3 mb-5">
        <input
          type="text"
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, marca o EAN…"
          className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
        />
        <button
          onClick={cargar}
          className="p-2.5 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors text-slate-500"
          title="Actualizar"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        <button
          onClick={() => setAgregando(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> Agregar producto
        </button>
      </div>

      {/* Contenido */}
      {cargando ? (
        <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <p className="text-sm">Cargando catálogo…</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-center">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      ) : filtrados.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <Package className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 text-sm font-medium mb-1">
            {busqueda ? 'Sin resultados para esa búsqueda' : 'Tu catálogo está vacío'}
          </p>
          <p className="text-slate-400 text-xs mb-5">
            {busqueda
              ? 'Prueba con otro nombre, marca o EAN'
              : 'Agrega tus productos con EAN para activar el matching automático y el análisis de competencia'}
          </p>
          {!busqueda && (
            <button
              onClick={() => setAgregando(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> Agregar primer producto
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            {filtrados.length} producto{filtrados.length !== 1 ? 's' : ''} —
            <span className="inline-flex items-center gap-0.5 mx-1"><ShoppingCart className="w-3 h-3" /> ver precios</span> en supermercados,
            <span className="inline-flex items-center gap-0.5 mx-1"><Users className="w-3 h-3" /> gestionar</span> competidores
          </p>
          {filtrados.map(p => (
            <FilaProducto key={p.id} p={p} onActualizar={cargar} />
          ))}
        </div>
      )}
    </>
  )
}

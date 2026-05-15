'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  RefreshCw, AlertTriangle, ChevronDown, ChevronRight,
  ShoppingCart, Package, Tag, Filter, X,
} from 'lucide-react'
import clsx from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PrecioTienda {
  supermercado_id: number
  supermercado:    string
  key:             string
  color:           string
  precio_normal:   number
  precio_oferta:   number | null
  en_oferta:       boolean
  descuento_pct:   number | null
  disponible:      boolean
}

interface Competidor {
  id:                 number
  nombre:             string
  marca:              string
  tipo_relacion:      'SUSTITUTO_DIRECTO' | 'ALTERNATIVA_PREMIUM' | 'ALTERNATIVA_ECONOMICA'
  factor_conversion:  number
  misma_presentacion: boolean
  prioridad:          1 | 2 | 3
  enlazado:           boolean
  precios:            PrecioTienda[]
}

interface ProductoComparativa {
  catalogo_id:    number
  nombre:         string
  marca:          string
  descripcion:    string
  imagen_url:     string | null
  pvp_sugerido:   number | null
  enlazado:       boolean
  precios_propio: PrecioTienda[]
  competidores:   Competidor[]
}

interface Grupo {
  categoria:    string | null
  subcategoria: string | null
  productos:    ProductoComparativa[]
}

interface Supermercado {
  key:    string
  nombre: string
  color:  string
}

interface ComparativaData {
  grupos:        Grupo[]
  supermercados: Supermercado[]
  filtros: {
    marcas:        string[]
    categorias:    string[]
    subcategorias: string[]
  }
  sin_datos: boolean
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const RELACION_LABEL: Record<string, string> = {
  SUSTITUTO_DIRECTO:    'Sustituto directo',
  ALTERNATIVA_PREMIUM:  'Alt. premium',
  ALTERNATIVA_ECONOMICA:'Alt. económica',
}
const RELACION_COLOR: Record<string, string> = {
  SUSTITUTO_DIRECTO:    'bg-blue-50 text-blue-700',
  ALTERNATIVA_PREMIUM:  'bg-purple-50 text-purple-700',
  ALTERNATIVA_ECONOMICA:'bg-green-50 text-green-700',
}

// ─── Chip de precio por tienda ────────────────────────────────────────────────

function ChipPrecio({ precio, isPropio }: { precio: PrecioTienda; isPropio: boolean }) {
  const efectivo = precio.en_oferta && precio.precio_oferta != null
    ? precio.precio_oferta
    : precio.precio_normal

  return (
    <div className={clsx(
      'flex flex-col items-center justify-center rounded-xl px-2 py-1.5 min-w-[70px] text-center',
      isPropio ? 'bg-blue-50 border border-blue-100' : 'bg-slate-50 border border-slate-100',
    )}>
      {/* Dot + key */}
      <div className="flex items-center gap-1 mb-0.5">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: precio.color }} />
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{precio.key || precio.supermercado.slice(0, 4)}</span>
      </div>
      {/* Precio */}
      {precio.en_oferta && precio.precio_oferta != null ? (
        <>
          <span className="text-[10px] text-slate-400 line-through leading-none">${precio.precio_normal.toFixed(2)}</span>
          <span className={clsx('text-sm font-bold leading-tight', isPropio ? 'text-blue-700' : 'text-emerald-700')}>
            ${precio.precio_oferta.toFixed(2)}
          </span>
          {precio.descuento_pct && (
            <span className="text-[9px] bg-emerald-100 text-emerald-700 font-bold px-1 rounded-full mt-0.5">
              -{precio.descuento_pct.toFixed(0)}%
            </span>
          )}
        </>
      ) : (
        <span className={clsx('text-sm font-bold leading-tight', isPropio ? 'text-blue-700' : 'text-slate-700')}>
          ${efectivo.toFixed(2)}
        </span>
      )}
    </div>
  )
}

// ─── Precio mínimo efectivo ───────────────────────────────────────────────────

function precioMin(precios: PrecioTienda[]): number | null {
  if (!precios.length) return null
  return Math.min(...precios.map(p => p.en_oferta && p.precio_oferta != null ? p.precio_oferta : p.precio_normal))
}

// ─── Fila de producto ─────────────────────────────────────────────────────────

function FilaProducto({ producto }: { producto: ProductoComparativa }) {
  const [expandido, setExpandido] = useState(false)

  const minPropio = precioMin(producto.precios_propio)
  const tieneCompetidores = producto.competidores.length > 0
  const tienePrecios = producto.precios_propio.length > 0

  // Calcular diferencia vs competidor más barato
  const minComp = producto.competidores.reduce<number | null>((acc, c) => {
    const m = precioMin(c.precios)
    if (m === null) return acc
    return acc === null ? m : Math.min(acc, m)
  }, null)

  let difPct: number | null = null
  if (minPropio !== null && minComp !== null && minComp > 0) {
    difPct = +((minPropio / minComp - 1) * 100).toFixed(1)
  }

  return (
    <div className={clsx(
      'rounded-xl border overflow-hidden transition-shadow',
      expandido ? 'border-blue-200 shadow-md' : 'border-slate-100 shadow-sm',
    )}>
      {/* ── Cabecera del producto propio ── */}
      <div
        className={clsx(
          'flex items-start gap-3 p-4 cursor-pointer select-none',
          expandido ? 'bg-blue-50' : 'bg-white hover:bg-slate-50/80',
        )}
        onClick={() => setExpandido(v => !v)}
      >
        {/* Indicador expand */}
        <div className="flex-shrink-0 mt-0.5 text-blue-400">
          {expandido
            ? <ChevronDown className="w-4 h-4" />
            : <ChevronRight className="w-4 h-4" />
          }
        </div>

        {/* Info producto */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm text-slate-800">{producto.nombre}</p>
            {producto.descripcion && (
              <span className="text-xs text-slate-400">{producto.descripcion}</span>
            )}
            <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
              {producto.marca}
            </span>
            {!producto.enlazado && (
              <span className="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full">
                Sin EAN
              </span>
            )}
          </div>

          {/* Precios en chips horizontales */}
          {tienePrecios ? (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {producto.precios_propio.map(pr => (
                <ChipPrecio key={pr.key} precio={pr} isPropio />
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 mt-1.5 italic">
              {producto.enlazado
                ? 'Sin precios scraped todavía — aparecerán en el próximo ciclo'
                : 'Agrega EAN-13 en Mi Catálogo para ver precios de supermercados'}
            </p>
          )}
        </div>

        {/* Métricas rápidas */}
        <div className="flex items-center gap-3 flex-shrink-0 text-right">
          {producto.pvp_sugerido && (
            <div className="text-center">
              <p className="text-[10px] text-slate-400">PVP</p>
              <p className="text-sm font-bold text-slate-700">${producto.pvp_sugerido.toFixed(2)}</p>
            </div>
          )}
          {minPropio !== null && (
            <div className="text-center">
              <p className="text-[10px] text-slate-400">Mi min.</p>
              <p className="text-sm font-bold text-blue-700">${minPropio.toFixed(2)}</p>
            </div>
          )}
          {difPct !== null && (
            <div className="text-center">
              <p className="text-[10px] text-slate-400">vs comp.</p>
              <p className={clsx(
                'text-sm font-bold',
                difPct > 5 ? 'text-amber-600' : difPct < -5 ? 'text-emerald-600' : 'text-slate-600',
              )}>
                {difPct > 0 ? '+' : ''}{difPct}%
              </p>
            </div>
          )}
          {tieneCompetidores && (
            <div className="text-center">
              <p className="text-[10px] text-slate-400">Comp.</p>
              <p className="text-sm font-bold text-slate-500">{producto.competidores.length}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Competidores expandidos ── */}
      {expandido && (
        <div className="border-t border-blue-100 divide-y divide-slate-50">
          {producto.competidores.length === 0 ? (
            <div className="px-4 py-3 bg-white text-center">
              <p className="text-xs text-slate-400">
                Sin competidores mapeados. Agrégalos en <span className="font-medium">Mi Catálogo</span> para comparar precios.
              </p>
            </div>
          ) : (
            producto.competidores.map(comp => {
              const minC = precioMin(comp.precios)
              let difComp: number | null = null
              if (minPropio !== null && minC !== null && minC > 0) {
                difComp = +((minPropio / minC - 1) * 100).toFixed(1)
              }

              return (
                <div key={comp.id} className="flex items-start gap-3 px-4 py-3 bg-white">
                  {/* Indent visual */}
                  <div className="w-4 flex-shrink-0 flex justify-center pt-1">
                    <div className="w-px h-full bg-slate-200 mx-auto" />
                  </div>

                  {/* Info competidor */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-slate-700">{comp.nombre}</p>
                      <span className="text-xs text-slate-500">{comp.marca}</span>
                      <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-medium', RELACION_COLOR[comp.tipo_relacion])}>
                        {RELACION_LABEL[comp.tipo_relacion]}
                      </span>
                      {!comp.misma_presentacion && (
                        <span className="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full">
                          ×{comp.factor_conversion} conversión
                        </span>
                      )}
                      {!comp.enlazado && (
                        <span className="text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full">
                          Sin EAN
                        </span>
                      )}
                    </div>

                    {comp.precios.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {comp.precios.map(pr => (
                          <ChipPrecio key={pr.key} precio={pr} isPropio={false} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 mt-1 italic">
                        {comp.enlazado
                          ? 'Sin precios scraped todavía'
                          : 'Agrega EAN-13 del competidor para ver sus precios'}
                      </p>
                    )}
                  </div>

                  {/* Diferencia de precio */}
                  {difComp !== null && (
                    <div className="flex-shrink-0 text-center">
                      <p className="text-[10px] text-slate-400">Mi precio</p>
                      <p className={clsx(
                        'text-sm font-bold',
                        difComp > 5 ? 'text-amber-600' : difComp < -5 ? 'text-emerald-600' : 'text-slate-600',
                      )}>
                        {difComp > 0 ? '+' : ''}{difComp}%
                      </p>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sección de categoría ─────────────────────────────────────────────────────

function SeccionGrupo({ grupo }: { grupo: Grupo }) {
  const [colapsado, setColapsado] = useState(false)

  const titulo = [grupo.categoria, grupo.subcategoria].filter(Boolean).join(' › ')

  return (
    <div className="space-y-3">
      {/* Header de categoría/subcategoría */}
      <button
        onClick={() => setColapsado(v => !v)}
        className="w-full flex items-center gap-2 py-1.5 group"
      >
        {colapsado
          ? <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600" />
          : <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-slate-600" />
        }
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 group-hover:text-slate-700">
          {titulo || 'Sin categoría'}
        </span>
        <span className="text-xs text-slate-400 font-normal">
          {grupo.productos.length} producto{grupo.productos.length !== 1 ? 's' : ''}
        </span>
        <div className="flex-1 h-px bg-slate-100 ml-1" />
      </button>

      {!colapsado && (
        <div className="space-y-2 pl-1">
          {grupo.productos.map(prod => (
            <FilaProducto key={prod.catalogo_id} producto={prod} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ComparativaCatalogo() {
  const [data,     setData]     = useState<ComparativaData | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  // Filtros
  const [filtroMarca,     setFiltroMarca]     = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [filtroSub,       setFiltroSub]       = useState('')

  const cargar = useCallback(async () => {
    setCargando(true); setError(null)
    try {
      const res = await fetch('/api/proveedores/comparativa')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Error')
      setData(await res.json())
    } catch (e: any) {
      setError(e.message ?? 'Error desconocido')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // ── Filtrar datos ──────────────────────────────────────────
  const gruposFiltrados = useMemo(() => {
    if (!data) return []
    return data.grupos
      .map(grupo => {
        const productos = grupo.productos.filter(p => {
          if (filtroMarca && p.marca !== filtroMarca) return false
          if (filtroCategoria && grupo.categoria !== filtroCategoria) return false
          if (filtroSub && grupo.subcategoria !== filtroSub) return false
          return true
        })
        return { ...grupo, productos }
      })
      .filter(g => g.productos.length > 0)
  }, [data, filtroMarca, filtroCategoria, filtroSub])

  const hayFiltros = filtroMarca || filtroCategoria || filtroSub
  const limpiarFiltros = () => { setFiltroMarca(''); setFiltroCategoria(''); setFiltroSub('') }

  // ── Render ─────────────────────────────────────────────────

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span className="text-sm">Cargando comparativa de catálogo…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center max-w-lg mx-auto">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
        <h3 className="font-semibold text-amber-800 mb-1">Error al cargar comparativa</h3>
        <p className="text-sm text-amber-700 mb-3">{error}</p>
        <button onClick={cargar} className="text-xs text-amber-800 underline">Reintentar</button>
      </div>
    )
  }

  if (!data || data.sin_datos || data.grupos.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center max-w-lg mx-auto">
        <Package className="w-10 h-10 text-slate-200 mx-auto mb-3" />
        <h3 className="font-semibold text-slate-700 mb-1">Sin productos en el catálogo</h3>
        <p className="text-sm text-slate-500">
          Registra tus productos en <span className="font-medium">Mi Catálogo</span> con su EAN-13 para activar la comparativa automática de precios.
        </p>
      </div>
    )
  }

  const totalProductos = data.grupos.reduce((s, g) => s + g.productos.length, 0)

  return (
    <div className="space-y-5">

      {/* ── Barra de filtros ── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-semibold text-slate-700">Filtros</span>
          {hayFiltros && (
            <button
              onClick={limpiarFiltros}
              className="ml-auto flex items-center gap-1 text-xs text-slate-500 hover:text-red-500 transition-colors"
            >
              <X className="w-3 h-3" /> Limpiar
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          {/* Marca */}
          {data.filtros.marcas.length > 0 && (
            <div>
              <label className="block text-[10px] font-medium text-slate-500 mb-1">Marca</label>
              <select
                value={filtroMarca}
                onChange={e => setFiltroMarca(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 min-w-[130px]"
              >
                <option value="">Todas</option>
                {data.filtros.marcas.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          )}

          {/* Categoría */}
          {data.filtros.categorias.length > 0 && (
            <div>
              <label className="block text-[10px] font-medium text-slate-500 mb-1">Categoría</label>
              <select
                value={filtroCategoria}
                onChange={e => { setFiltroCategoria(e.target.value); setFiltroSub('') }}
                className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 min-w-[160px]"
              >
                <option value="">Todas</option>
                {data.filtros.categorias.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}

          {/* SubCategoría */}
          {data.filtros.subcategorias.length > 0 && (
            <div>
              <label className="block text-[10px] font-medium text-slate-500 mb-1">SubCategoría</label>
              <select
                value={filtroSub}
                onChange={e => setFiltroSub(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 min-w-[160px]"
              >
                <option value="">Todas</option>
                {data.filtros.subcategorias.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          {/* Sin categorías aún */}
          {data.filtros.categorias.length === 0 && (
            <p className="text-xs text-slate-400 self-center">
              <Tag className="w-3 h-3 inline mr-1" />
              Agrega Categoría y SubCategoría a tus productos en Mi Catálogo para filtrar aquí.
            </p>
          )}
        </div>
      </div>

      {/* ── Leyenda de cadenas ── */}
      {data.supermercados.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap px-1">
          <span className="text-xs text-slate-400">Cadenas:</span>
          {data.supermercados.map(s => (
            <span key={s.key} className="flex items-center gap-1 text-xs text-slate-500">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
              {s.nombre}
            </span>
          ))}
          <span className="ml-auto text-xs text-slate-400">
            {hayFiltros
              ? `${gruposFiltrados.reduce((s, g) => s + g.productos.length, 0)} de ${totalProductos} productos`
              : `${totalProductos} producto${totalProductos !== 1 ? 's' : ''}`
            }
          </span>
          <button
            onClick={cargar}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
            title="Actualizar"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ── Grupos de productos ── */}
      {gruposFiltrados.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center">
          <p className="text-slate-500 text-sm">Sin resultados para los filtros seleccionados</p>
          <button onClick={limpiarFiltros} className="text-xs text-blue-600 underline mt-2">Limpiar filtros</button>
        </div>
      ) : (
        <div className="space-y-6">
          {gruposFiltrados.map((grupo, i) => (
            <SeccionGrupo
              key={`${grupo.categoria ?? ''}-${grupo.subcategoria ?? ''}-${i}`}
              grupo={grupo}
            />
          ))}
        </div>
      )}

      {/* ── Pie de página ── */}
      <p className="text-center text-xs text-slate-300 pb-2">
        Precios actualizados automáticamente por los scrapers · Haz clic en un producto para ver competidores
      </p>
    </div>
  )
}

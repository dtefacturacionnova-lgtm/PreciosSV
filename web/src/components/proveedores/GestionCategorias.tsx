'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  RefreshCw, LayoutGrid, TrendingDown, TrendingUp,
  ShoppingBag, AlertTriangle, Store, Tag,
} from 'lucide-react'
import clsx from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TopMarca {
  marca: string
  count: number
}

interface PorSuper {
  supermercado: string
  color:        string
  count:        number
}

interface Categoria {
  nombre:                  string
  total_productos:         number
  mis_productos:           number
  share_pct:               number
  precio_promedio_mercado: number | null
  precio_promedio_propio:  number | null
  indice_precio:           number | null
  oferta_pct:              number
  top_marcas:              TopMarca[]
  por_supermercado:        PorSuper[]
}

interface Resumen {
  total_categorias:     number
  categorias_presentes: number
  total_productos_db:   number
  mis_productos_total:  number
  mejor_indice: { nombre: string; indice: number | null } | null
  peor_indice:  { nombre: string; indice: number | null } | null
}

interface CategoriasData {
  categorias: Categoria[]
  resumen:    Resumen
  sin_datos:  boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function IndiceChip({ indice }: { indice: number | null }) {
  if (indice === null) return <span className="text-xs text-slate-300">—</span>
  if (indice > 5)  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-bold text-red-600">
      <TrendingUp className="w-3 h-3" />{indice > 0 ? '+' : ''}{indice}%
    </span>
  )
  if (indice < -5) return (
    <span className="inline-flex items-center gap-0.5 text-xs font-bold text-emerald-600">
      <TrendingDown className="w-3 h-3" />{indice}%
    </span>
  )
  return <span className="text-xs font-bold text-slate-600">{indice > 0 ? '+' : ''}{indice}%</span>
}

function MiniBarras({ supermercados, max }: { supermercados: PorSuper[]; max: number }) {
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {supermercados.slice(0, 5).map(s => {
        const pct = max > 0 ? Math.round((s.count / max) * 100) : 0
        return (
          <div key={s.supermercado} className="flex flex-col items-center gap-0.5">
            <div className="w-6 h-8 flex items-end">
              <div
                className="w-full rounded-t transition-all"
                style={{ height: `${Math.max(pct * 0.32, 4)}px`, backgroundColor: s.color }}
              />
            </div>
            <span className="text-[9px] text-slate-400 truncate w-7 text-center">
              {s.supermercado.substring(0, 3)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Vista expandida de una categoría ────────────────────────────────────────

function CategoriaDetalle({ cat }: { cat: Categoria }) {
  const maxCount = cat.por_supermercado[0]?.count ?? 1

  return (
    <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-4">

      {/* Precio */}
      <div>
        <p className="text-xs font-semibold text-slate-500 mb-2">Precios</p>
        {cat.precio_promedio_mercado !== null ? (
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Mercado avg</span>
              <span className="font-semibold text-slate-700">${cat.precio_promedio_mercado.toFixed(2)}</span>
            </div>
            {cat.precio_promedio_propio !== null && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Mis productos</span>
                <span className="font-semibold text-blue-700">${cat.precio_promedio_propio.toFixed(2)}</span>
              </div>
            )}
            {cat.indice_precio !== null && (
              <div className="flex justify-between text-xs pt-1 border-t border-slate-100">
                <span className="text-slate-500">Índice vs mercado</span>
                <IndiceChip indice={cat.indice_precio} />
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-300">Sin datos de precio</p>
        )}
      </div>

      {/* Marcas */}
      <div>
        <p className="text-xs font-semibold text-slate-500 mb-2">Top marcas</p>
        <div className="space-y-1">
          {cat.top_marcas.slice(0, 4).map(m => (
            <div key={m.marca} className="flex justify-between text-xs">
              <span className="text-slate-600 truncate max-w-[120px]">{m.marca || 'Sin marca'}</span>
              <span className="text-slate-400 font-medium">{m.count} prod.</span>
            </div>
          ))}
          {cat.top_marcas.length === 0 && <p className="text-xs text-slate-300">—</p>}
        </div>
      </div>

      {/* Cadenas */}
      <div>
        <p className="text-xs font-semibold text-slate-500 mb-2">Presencia por cadena</p>
        <div className="space-y-1.5">
          {cat.por_supermercado.slice(0, 5).map(s => {
            const pct = maxCount > 0 ? Math.round((s.count / maxCount) * 100) : 0
            return (
              <div key={s.supermercado}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-slate-600">{s.supermercado}</span>
                  <span className="text-slate-400">{s.count} prod.</span>
                </div>
                <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: s.color }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

    </div>
  )
}

// ─── Tabla de categorías ───────────────────────────────────────────────────────

type Filtro = 'todas' | 'presentes' | 'ausentes'
type Orden  = 'tamaño' | 'share' | 'indice' | 'promo'

function TablaCategorias({ categorias }: { categorias: Categoria[] }) {
  const [filtro,     setFiltro]     = useState<Filtro>('todas')
  const [orden,      setOrden]      = useState<Orden>('tamaño')
  const [expandida,  setExpandida]  = useState<string | null>(null)

  const lista = categorias
    .filter(c => {
      if (filtro === 'presentes') return c.mis_productos > 0
      if (filtro === 'ausentes')  return c.mis_productos === 0
      return true
    })
    .sort((a, b) => {
      if (orden === 'tamaño') return b.total_productos - a.total_productos
      if (orden === 'share')  return b.share_pct - a.share_pct
      if (orden === 'indice') return (Math.abs(b.indice_precio ?? 0)) - (Math.abs(a.indice_precio ?? 0))
      return b.oferta_pct - a.oferta_pct
    })

  const maxProd = lista[0]?.total_productos ?? 1

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-4 border-b border-slate-100 flex-wrap">
        <div className="flex items-center gap-2">
          <LayoutGrid className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-700">Categorías del mercado</h3>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Filtro */}
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
            {(['todas', 'presentes', 'ausentes'] as Filtro[]).map(f => (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                className={clsx(
                  'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all capitalize',
                  filtro === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                )}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Orden */}
          <select
            value={orden}
            onChange={e => setOrden(e.target.value as Orden)}
            className="text-xs border border-slate-200 rounded-xl px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            <option value="tamaño">Ordenar: Tamaño</option>
            <option value="share">Ordenar: Mi share</option>
            <option value="indice">Ordenar: Índice precio</option>
            <option value="promo">Ordenar: Promos</option>
          </select>
        </div>
      </div>

      <div className="divide-y divide-slate-50">
        {lista.map(cat => {
          const presente = cat.mis_productos > 0
          const isOpen   = expandida === cat.nombre
          return (
            <div key={cat.nombre} className={clsx('px-4 py-3', isOpen ? 'bg-blue-50/30' : 'hover:bg-slate-50/50 transition-colors')}>
              <button
                onClick={() => setExpandida(isOpen ? null : cat.nombre)}
                className="w-full text-left"
              >
                <div className="flex items-center gap-4 flex-wrap">
                  {/* Nombre + badge */}
                  <div className="min-w-[140px] flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-800">{cat.nombre}</p>
                      {presente ? (
                        <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-1.5 py-0.5 rounded-full">
                          {cat.mis_productos} míos
                        </span>
                      ) : (
                        <span className="text-xs bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full">ausente</span>
                      )}
                    </div>
                    {/* Barra de tamaño */}
                    <div className="mt-1.5 h-1 bg-slate-100 rounded-full overflow-hidden max-w-xs">
                      <div
                        className="h-full rounded-full bg-slate-300"
                        style={{ width: `${maxProd > 0 ? (cat.total_productos / maxProd) * 100 : 0}%` }}
                      />
                    </div>
                  </div>

                  {/* Productos total */}
                  <div className="text-center min-w-[60px]">
                    <p className="text-sm font-bold text-slate-700">{cat.total_productos}</p>
                    <p className="text-xs text-slate-400">productos</p>
                  </div>

                  {/* Share */}
                  <div className="text-center min-w-[65px]">
                    <p className={clsx('text-sm font-bold', presente ? 'text-blue-700' : 'text-slate-300')}>
                      {cat.share_pct}%
                    </p>
                    <p className="text-xs text-slate-400">mi share</p>
                  </div>

                  {/* Índice precio */}
                  <div className="text-center min-w-[70px]">
                    <IndiceChip indice={cat.indice_precio} />
                    <p className="text-xs text-slate-400 mt-0.5">vs mercado</p>
                  </div>

                  {/* Oferta% */}
                  <div className="text-center min-w-[60px]">
                    <p className={clsx('text-sm font-bold', cat.oferta_pct >= 20 ? 'text-amber-600' : 'text-slate-500')}>
                      {cat.oferta_pct}%
                    </p>
                    <p className="text-xs text-slate-400">en oferta</p>
                  </div>

                  {/* Mini barras cadenas */}
                  <div className="hidden md:block">
                    <MiniBarras supermercados={cat.por_supermercado} max={cat.total_productos} />
                  </div>

                  <span className={clsx('text-xs text-slate-400 ml-auto', isOpen ? 'rotate-180' : '')}>▾</span>
                </div>
              </button>

              {isOpen && <CategoriaDetalle cat={cat} />}
            </div>
          )
        })}

        {lista.length === 0 && (
          <div className="p-8 text-center">
            <p className="text-sm text-slate-400">No hay categorías en esta vista</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function GestionCategorias() {
  const [data,    setData]    = useState<CategoriasData | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const res = await fetch('/api/proveedores/categorias')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Error')
      setData(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span className="text-sm">Cargando análisis de categorías…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center max-w-lg mx-auto">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
        <p className="text-sm text-amber-700 mb-3">{error}</p>
        <button onClick={cargar} className="text-xs text-amber-800 underline">Reintentar</button>
      </div>
    )
  }

  if (!data || data.sin_datos) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
        <LayoutGrid className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <h3 className="font-semibold text-slate-600 mb-1">Sin datos de categorías</h3>
        <p className="text-sm text-slate-400 max-w-sm mx-auto">
          Aún no hay productos scrapeados en la base de datos.
        </p>
      </div>
    )
  }

  const { resumen } = data

  return (
    <div className="space-y-5">

      {/* Resumen global */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: 'Categorías en BD',
            val:   resumen.total_categorias,
            sub:   `${resumen.total_productos_db.toLocaleString()} productos totales`,
            icon:  LayoutGrid,
            color: 'text-slate-700',
          },
          {
            label: 'Categorías con presencia',
            val:   resumen.categorias_presentes,
            sub:   `de ${resumen.total_categorias} categorías`,
            icon:  Store,
            color: 'text-blue-700',
          },
          {
            label: 'Mejor índice precio',
            val:   resumen.mejor_indice?.indice != null
              ? `${resumen.mejor_indice.indice > 0 ? '+' : ''}${resumen.mejor_indice.indice}%`
              : '—',
            sub:   resumen.mejor_indice?.nombre ?? '—',
            icon:  TrendingDown,
            color: 'text-emerald-700',
          },
          {
            label: 'Peor índice precio',
            val:   resumen.peor_indice?.indice != null
              ? `${resumen.peor_indice.indice > 0 ? '+' : ''}${resumen.peor_indice.indice}%`
              : '—',
            sub:   resumen.peor_indice?.nombre ?? '—',
            icon:  TrendingUp,
            color: 'text-red-600',
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

      {/* Leyenda del índice de precio */}
      <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="font-semibold text-slate-600">Índice de precio:</span>
        <span className="flex items-center gap-1"><TrendingDown className="w-3 h-3 text-emerald-600" /> negativo → mis productos más baratos que el mercado</span>
        <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3 text-red-500" /> positivo → mis productos más caros</span>
        <span>Umbral ±5% para considerar diferencia significativa</span>
      </div>

      {/* Tabla principal */}
      <TablaCategorias categorias={data.categorias} />

      {/* Nota de share */}
      <p className="text-xs text-slate-400 text-center">
        Share = mis productos / total de productos en esa categoría en la BD. No equivale a cuota de mercado real.
      </p>

    </div>
  )
}

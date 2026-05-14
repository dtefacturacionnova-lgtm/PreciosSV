'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import clsx from 'clsx'

const ORDENES = [
  { value: 'relevancia', label: 'Relevancia' },
  { value: 'precio_asc', label: 'Precio: menor a mayor' },
  { value: 'precio_desc', label: 'Precio: mayor a menor' },
  { value: 'descuento', label: 'Mayor descuento' },
]

const CATEGORIAS = [
  { slug: '', label: 'Todas las categorías' },
  { slug: 'lacteos-huevos', label: '🥛 Lácteos y Huevos' },
  { slug: 'carnes', label: '🥩 Carnes' },
  { slug: 'frutas-verduras', label: '🥦 Frutas y Verduras' },
  { slug: 'abarrotes', label: '🛒 Abarrotes' },
  { slug: 'bebidas', label: '🧃 Bebidas' },
  { slug: 'limpieza', label: '🧹 Limpieza' },
  { slug: 'cuidado-personal', label: '🧴 Cuidado Personal' },
  { slug: 'panaderia', label: '🍞 Panadería' },
  { slug: 'congelados', label: '🧊 Congelados' },
]

const SUPERMERCADOS = [
  { key: '', label: 'Todos', color: '#6B7280' },
  { key: 'selectos', label: 'Súper Selectos', color: '#DC2626' },
  { key: 'walmart', label: 'Walmart', color: '#1D4ED8' },
  { key: 'donjuan', label: 'Don Juan', color: '#16A34A' },
  { key: 'maxidespensa', label: 'Maxi Despensa', color: '#EA580C' },
  { key: 'familiar', label: 'Familiar', color: '#7C3AED' },
]

export default function FiltrosBusqueda() {
  const router = useRouter()
  const params = useSearchParams()

  const q           = params.get('q') ?? ''
  const categoria   = params.get('categoria') ?? ''
  const supermercado = params.get('supermercado') ?? ''
  const orden       = params.get('orden') ?? 'relevancia'
  const soloOfertas = params.get('solo_ofertas') === 'true'

  const update = useCallback((key: string, value: string | boolean) => {
    const next = new URLSearchParams(params.toString())
    if (!value) next.delete(key)
    else next.set(key, String(value))
    next.delete('page')
    router.push(`/buscar?${next.toString()}`)
  }, [params, router])

  const hayFiltros = categoria || supermercado || soloOfertas || orden !== 'relevancia'

  return (
    <aside className="w-full lg:w-60 flex-shrink-0">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sticky top-20">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <SlidersHorizontal className="w-4 h-4" />
            Filtros
          </div>
          {hayFiltros && (
            <button
              onClick={() => router.push(`/buscar?q=${q}`)}
              className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1 transition-colors"
            >
              <X className="w-3 h-3" /> Limpiar
            </button>
          )}
        </div>

        {/* Ordenar */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Ordenar por</p>
          <div className="flex flex-col gap-1">
            {ORDENES.map(o => (
              <button
                key={o.value}
                onClick={() => update('orden', o.value === 'relevancia' ? '' : o.value)}
                className={clsx(
                  'text-left text-sm px-3 py-2 rounded-lg transition-colors',
                  orden === o.value
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-slate-600 hover:bg-slate-50'
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Solo ofertas */}
        <div className="mb-5 pb-5 border-b border-slate-100">
          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              onClick={() => update('solo_ofertas', !soloOfertas ? 'true' : '')}
              className={clsx(
                'w-10 h-6 rounded-full transition-colors relative',
                soloOfertas ? 'bg-amber-400' : 'bg-slate-200'
              )}
            >
              <div className={clsx(
                'absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all',
                soloOfertas ? 'left-5' : 'left-1'
              )} />
            </div>
            <span className="text-sm text-slate-600 group-hover:text-slate-800">Solo en oferta</span>
          </label>
        </div>

        {/* Supermercado */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Supermercado</p>
          <div className="flex flex-col gap-1">
            {SUPERMERCADOS.map(s => (
              <button
                key={s.key}
                onClick={() => update('supermercado', s.key)}
                className={clsx(
                  'flex items-center gap-2 text-left text-sm px-3 py-2 rounded-lg transition-colors',
                  supermercado === s.key
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-slate-600 hover:bg-slate-50'
                )}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Categoría */}
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Categoría</p>
          <div className="flex flex-col gap-1">
            {CATEGORIAS.map(c => (
              <button
                key={c.slug}
                onClick={() => update('categoria', c.slug)}
                className={clsx(
                  'text-left text-sm px-3 py-2 rounded-lg transition-colors',
                  categoria === c.slug
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-slate-600 hover:bg-slate-50'
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

      </div>
    </aside>
  )
}

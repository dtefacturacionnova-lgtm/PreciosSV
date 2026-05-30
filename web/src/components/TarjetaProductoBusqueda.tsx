'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Package, Store, ShoppingCart, Check } from 'lucide-react'
import clsx from 'clsx'
import { useCanasta } from '@/lib/canasta'

interface Props {
  id:                      number
  nombre_normalizado:      string
  marca:                   string | null
  imagen_url:              string | null
  categoria_nombre:        string | null
  precio_min:              number | null
  precio_max:              number | null
  en_oferta:               boolean
  descuento_max:           number | null
  tiendas:                 number
  supermercado_mas_barato: string | null
  color_mas_barato:        string | null
}

export default function TarjetaProductoBusqueda({
  id,
  nombre_normalizado,
  marca,
  imagen_url,
  precio_min,
  precio_max,
  en_oferta,
  descuento_max,
  tiendas,
  supermercado_mas_barato,
  color_mas_barato,
}: Props) {
  const [agregado, setAgregado] = useState(false)
  const { agregar, estaEnCanasta } = useCanasta()

  const hayVariacion = precio_max && precio_min && precio_max > precio_min * 1.01

  const handleAgregar = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    agregar({ id, nombre: nombre_normalizado, imagen_url })
    setAgregado(true)
    setTimeout(() => setAgregado(false), 2000)
  }

  return (
    <div className="group relative bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-slate-200 transition-all duration-200">
      <Link
        href={`/producto/${id}`}
        className="flex gap-4 p-4 items-start"
      >
        {/* Imagen */}
        <div className="w-20 h-20 flex-shrink-0 bg-slate-50 rounded-xl flex items-center justify-center overflow-hidden">
          {imagen_url ? (
            <img
              src={imagen_url}
              alt={nombre_normalizado}
              className="max-h-16 max-w-full object-contain group-hover:scale-105 transition-transform duration-200"
            />
          ) : (
            <Package className="w-8 h-8 text-slate-300" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 pr-10">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {marca && (
                <p className="text-xs text-slate-400 font-medium truncate">{marca}</p>
              )}
              <p className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2 group-hover:text-blue-700 transition-colors">
                {nombre_normalizado}
              </p>
            </div>

            {/* Badge descuento */}
            {en_oferta && descuento_max && (
              <span className="flex-shrink-0 text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                -{descuento_max.toFixed(0)}%
              </span>
            )}
          </div>

          {/* Precios */}
          <div className="mt-2 flex items-baseline gap-2 flex-wrap">
            {precio_min ? (
              <>
                <span className="text-lg font-bold text-slate-900">
                  ${precio_min.toFixed(2)}
                </span>
                {hayVariacion && (
                  <span className="text-xs text-slate-400">
                    hasta ${precio_max!.toFixed(2)}
                  </span>
                )}
              </>
            ) : (
              <span className="text-sm text-slate-400 italic">Sin precio disponible</span>
            )}
          </div>

          {/* Footer: tienda más barata + conteo */}
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            {supermercado_mas_barato && (
              <div className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color_mas_barato ?? '#6B7280' }}
                />
                <span className="text-xs text-slate-500">{supermercado_mas_barato}</span>
              </div>
            )}
            {tiendas > 1 && (
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <Store className="w-3 h-3" />
                {tiendas} tiendas
              </div>
            )}
          </div>
        </div>
      </Link>

      {/* Botón agregar a canasta — absoluto para no interferir con el Link */}
      <button
        onClick={handleAgregar}
        title={agregado ? '¡Agregado!' : estaEnCanasta(id) ? 'Ya en canasta — agregar más' : 'Agregar a canasta'}
        className={clsx(
          'absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center transition-all',
          agregado
            ? 'bg-blue-100 text-blue-600 scale-110'
            : estaEnCanasta(id)
            ? 'bg-blue-50 text-blue-500 hover:bg-blue-100'
            : 'bg-slate-100 text-slate-400 hover:bg-blue-50 hover:text-blue-500'
        )}
      >
        {agregado ? <Check className="w-4 h-4" /> : <ShoppingCart className="w-4 h-4" />}
      </button>
    </div>
  )
}

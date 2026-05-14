'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Package, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import clsx from 'clsx'

interface PrecioPorTienda {
  supermercado:  string
  key:           string
  color:         string
  precio_normal: number
  precio_oferta: number | null
  en_oferta:     boolean
  descuento_pct: number | null
  disponible:    boolean
}

interface ProductoRow {
  id:               number
  nombre:           string
  marca:            string | null
  imagen_url:       string | null
  categoria:        string | null
  precio_min:       number | null
  en_oferta:        boolean
  descuento_max:    number | null
  tiendas:          number
  tienda_mas_barata: string | null
  color_mas_barata: string | null
  precios_por_tienda: PrecioPorTienda[]
}

interface Props {
  productos: ProductoRow[]
}

function FilaProducto({ prod }: { prod: ProductoRow }) {
  const [expandido, setExpandido] = useState(false)

  return (
    <>
      <tr
        className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors cursor-pointer"
        onClick={() => setExpandido(v => !v)}
      >
        {/* Producto */}
        <td className="py-3 px-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
              {prod.imagen_url ? (
                <img src={prod.imagen_url} alt={prod.nombre} className="max-h-8 max-w-8 object-contain" />
              ) : (
                <Package className="w-4 h-4 text-slate-400" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 truncate max-w-xs">{prod.nombre}</p>
              <p className="text-xs text-slate-400">{prod.categoria ?? prod.marca ?? ''}</p>
            </div>
          </div>
        </td>

        {/* Precio mín */}
        <td className="py-3 px-4 text-right">
          {prod.precio_min ? (
            <span className="text-sm font-bold text-slate-800">${prod.precio_min.toFixed(2)}</span>
          ) : (
            <span className="text-xs text-slate-400 italic">—</span>
          )}
        </td>

        {/* Mejor tienda */}
        <td className="py-3 px-4">
          {prod.tienda_mas_barata ? (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: prod.color_mas_barata ?? '#6B7280' }} />
              <span className="text-xs text-slate-600">{prod.tienda_mas_barata}</span>
            </div>
          ) : <span className="text-xs text-slate-400">—</span>}
        </td>

        {/* Oferta */}
        <td className="py-3 px-4 text-center">
          {prod.en_oferta && prod.descuento_max ? (
            <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              -{prod.descuento_max.toFixed(0)}%
            </span>
          ) : (
            <span className="text-xs text-slate-300">—</span>
          )}
        </td>

        {/* Tiendas */}
        <td className="py-3 px-4 text-center">
          <span className="text-sm text-slate-600">{prod.tiendas}</span>
        </td>

        {/* Expandir */}
        <td className="py-3 px-4 text-right">
          <div className="flex items-center justify-end gap-2">
            <Link
              href={`/producto/${prod.id}`}
              onClick={e => e.stopPropagation()}
              className="text-blue-600 hover:text-blue-800"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
            {expandido ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </div>
        </td>
      </tr>

      {/* Fila expandida: precios por tienda */}
      {expandido && (
        <tr className="bg-slate-50/80">
          <td colSpan={6} className="px-4 py-3">
            <div className="flex flex-wrap gap-3 ml-13">
              {prod.precios_por_tienda.map(p => (
                <div
                  key={p.key}
                  className={clsx(
                    'flex items-center gap-2 bg-white rounded-xl border px-3 py-2 text-sm',
                    p.en_oferta ? 'border-amber-200' : 'border-slate-100'
                  )}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                  <span className="text-slate-500 text-xs font-medium">{p.supermercado}</span>
                  <div className="flex items-baseline gap-1">
                    {p.en_oferta && p.precio_oferta ? (
                      <>
                        <span className="text-xs text-slate-400 line-through">${p.precio_normal.toFixed(2)}</span>
                        <span className="font-bold text-amber-700">${p.precio_oferta.toFixed(2)}</span>
                      </>
                    ) : (
                      <span className="font-semibold text-slate-700">${p.precio_normal.toFixed(2)}</span>
                    )}
                  </div>
                  {p.en_oferta && p.descuento_pct && (
                    <span className="text-xs bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded-full">
                      -{p.descuento_pct.toFixed(0)}%
                    </span>
                  )}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default function TablaProductos({ productos }: Props) {
  if (!productos.length) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center">
        <Package className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-slate-500 text-sm">No se encontraron productos para tus marcas registradas.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide py-3 px-4">Producto</th>
            <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wide py-3 px-4">Precio mín.</th>
            <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide py-3 px-4">Más barato en</th>
            <th className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wide py-3 px-4">Oferta</th>
            <th className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wide py-3 px-4">Tiendas</th>
            <th className="py-3 px-4"></th>
          </tr>
        </thead>
        <tbody>
          {productos.map(p => (
            <FilaProducto key={p.id} prod={p} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

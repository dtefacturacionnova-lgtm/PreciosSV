'use client'

import { ExternalLink, Trophy, Tag } from 'lucide-react'
import clsx from 'clsx'

interface PrecioSuper {
  supermercado_id: number
  supermercado_nombre: string
  supermercado_key: string
  supermercado_color: string
  url_producto: string | null
  precio_normal: number
  precio_oferta: number | null
  precio_efectivo: number
  en_oferta: boolean
  descuento_pct: number | null
  disponible: boolean
  condicion_oferta: string | null
  fecha_hora: string
}

interface Props {
  precios: PrecioSuper[]
}

export default function ComparativaPrecios({ precios }: Props) {
  if (!precios.length) {
    return (
      <div className="text-center py-10 text-slate-400">
        No hay precios disponibles para este producto.
      </div>
    )
  }

  const precioMin = precios[0]?.precio_efectivo
  const precioMax = precios[precios.length - 1]?.precio_efectivo
  const ahorroMax = precioMax - precioMin

  return (
    <div className="flex flex-col gap-3">

      {/* Resumen de ahorro */}
      {ahorroMax > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <Trophy className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <p className="text-sm text-emerald-800">
            Comprando en <strong>{precioMin === precios[0].precio_efectivo ? precios[0].supermercado_nombre : ''}</strong> ahorras{' '}
            <strong>${ahorroMax.toFixed(2)}</strong> vs. el más caro
          </p>
        </div>
      )}

      {/* Tabla de precios */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="text-left text-xs font-semibold text-slate-500 px-4 py-3">Supermercado</th>
              <th className="text-right text-xs font-semibold text-slate-500 px-4 py-3">Precio normal</th>
              <th className="text-right text-xs font-semibold text-slate-500 px-4 py-3">Precio oferta</th>
              <th className="text-right text-xs font-semibold text-slate-500 px-4 py-3 hidden sm:table-cell">Descuento</th>
              <th className="text-center text-xs font-semibold text-slate-500 px-4 py-3 hidden md:table-cell">Condición</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {precios.map((p, idx) => {
              const esMejor = idx === 0
              const esMasCaro = idx === precios.length - 1 && precios.length > 1

              return (
                <tr
                  key={p.supermercado_id}
                  className={clsx(
                    'border-b border-slate-50 last:border-0 transition-colors',
                    esMejor ? 'bg-emerald-50/50' : 'hover:bg-slate-50'
                  )}
                >
                  {/* Supermercado */}
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: p.supermercado_color }}
                      />
                      <span className="font-medium text-slate-800 text-sm">
                        {p.supermercado_nombre}
                      </span>
                      {esMejor && (
                        <span className="hidden sm:inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 font-semibold px-2 py-0.5 rounded-full">
                          <Trophy className="w-3 h-3" /> Mejor precio
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Precio normal */}
                  <td className="px-4 py-4 text-right">
                    <span className={clsx(
                      'text-sm',
                      p.en_oferta ? 'line-through text-slate-400' : 'font-semibold text-slate-900'
                    )}>
                      ${p.precio_normal.toFixed(2)}
                    </span>
                  </td>

                  {/* Precio oferta */}
                  <td className="px-4 py-4 text-right">
                    {p.en_oferta ? (
                      <span className={clsx(
                        'font-bold text-base',
                        esMejor ? 'text-emerald-700' : 'text-slate-900'
                      )}>
                        ${p.precio_oferta!.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-sm">—</span>
                    )}
                  </td>

                  {/* Descuento */}
                  <td className="px-4 py-4 text-right hidden sm:table-cell">
                    {p.descuento_pct ? (
                      <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 font-bold px-2 py-1 rounded-full">
                        -{Math.round(p.descuento_pct)}%
                      </span>
                    ) : (
                      <span className="text-slate-300 text-sm">—</span>
                    )}
                  </td>

                  {/* Condición */}
                  <td className="px-4 py-4 text-center hidden md:table-cell">
                    {p.condicion_oferta ? (
                      <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full font-medium">
                        <Tag className="w-3 h-3" />
                        {p.condicion_oferta}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-sm">—</span>
                    )}
                  </td>

                  {/* Link */}
                  <td className="px-4 py-4">
                    {p.url_producto ? (
                      <a
                        href={p.url_producto}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap"
                      >
                        Ver <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400 text-right">
        Actualizado cada 6 horas · Última actualización: {new Date(precios[0]?.fecha_hora).toLocaleString('es-SV')}
      </p>
    </div>
  )
}

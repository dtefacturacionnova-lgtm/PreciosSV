import Image from 'next/image'
import Link from 'next/link'
import type { OfertaDelDia } from '@/types/database'

interface Props {
  oferta: OfertaDelDia
}

export default function TarjetaOferta({ oferta }: Props) {
  const {
    producto_id,
    nombre_normalizado,
    marca,
    imagen_url,
    precio_normal,
    precio_oferta,
    descuento_pct,
    condicion_oferta,
    supermercado_nombre,
    supermercado_color,
  } = oferta

  return (
    <Link
      href={`/producto/${producto_id}`}
      className="group bg-white rounded-2xl shadow-sm border border-slate-100
                 hover:shadow-md hover:border-slate-200 transition-all duration-200
                 flex flex-col overflow-hidden"
    >
      {/* Imagen */}
      <div className="relative bg-slate-50 p-4 aspect-square flex items-center justify-center">
        {/* Badge de descuento */}
        <div className="absolute top-3 right-3 w-11 h-11 rounded-full bg-[#F59E0B]
                        flex items-center justify-center shadow-sm z-10">
          <span className="text-xs font-bold text-white leading-tight text-center">
            -{Math.round(descuento_pct)}%
          </span>
        </div>

        {imagen_url ? (
          <Image
            src={imagen_url}
            alt={nombre_normalizado}
            width={160}
            height={120}
            className="object-contain max-h-28 group-hover:scale-105 transition-transform duration-200"
          />
        ) : (
          <div className="w-24 h-24 rounded-xl bg-slate-100 flex items-center justify-center">
            <span className="text-3xl">🛒</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-1 flex-1">
        <p className="text-xs text-slate-400 font-medium truncate">{marca}</p>
        <h3 className="text-sm font-semibold text-slate-800 line-clamp-2 leading-snug">
          {nombre_normalizado}
        </h3>

        {condicion_oferta && (
          <span className="text-xs text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full w-fit">
            {condicion_oferta}
          </span>
        )}

        {/* Precios */}
        <div className="mt-auto pt-2 border-t border-slate-100">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-slate-400 line-through">
              ${precio_normal.toFixed(2)}
            </span>
            <span className="text-lg font-bold text-slate-900">
              ${precio_oferta.toFixed(2)}
            </span>
          </div>

          {/* Indicador de supermercado */}
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: supermercado_color }}
            />
            <span className="text-xs text-slate-500 truncate">{supermercado_nombre}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Share2, ExternalLink, ShoppingCart, Check } from 'lucide-react'
import type { OfertaDelDia } from '@/types/database'
import { useCanasta } from '@/lib/canasta'

export default function TarjetaOferta({ oferta }: { oferta: OfertaDelDia }) {
  const [copiado,  setCopiado]  = useState(false)
  const [agregado, setAgregado] = useState(false)
  const { agregar, estaEnCanasta } = useCanasta()

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
    url_producto,
  } = oferta

  const handleAgregar = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    agregar({ id: producto_id, nombre: nombre_normalizado, imagen_url })
    setAgregado(true)
    setTimeout(() => setAgregado(false), 2000)
  }

  const handleShare = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const url   = `${window.location.origin}/producto/${producto_id}`
    const texto = `${nombre_normalizado} a $${precio_oferta.toFixed(2)} (-${Math.round(descuento_pct)}%) en ${supermercado_nombre}`
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({ title: nombre_normalizado, text: texto, url }).catch(() => {})
    } else {
      navigator.clipboard.writeText(`${texto} → ${url}`).then(() => {
        setCopiado(true)
        setTimeout(() => setCopiado(false), 2000)
      }).catch(() => {})
    }
  }

  return (
    <div className="group bg-white rounded-2xl shadow-sm border border-slate-100
                    hover:shadow-md hover:border-slate-200 transition-all duration-200
                    flex flex-col overflow-hidden">

      {/* Imagen — clickeable → detalle del producto */}
      <Link
        href={`/producto/${producto_id}`}
        className="relative bg-slate-50 p-4 aspect-square flex items-center justify-center"
      >
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
      </Link>

      {/* Info */}
      <div className="p-3 flex flex-col gap-1 flex-1">

        {/* Nombre y marca → detalle */}
        <Link href={`/producto/${producto_id}`} className="flex flex-col gap-1 flex-1">
          <p className="text-xs text-slate-400 font-medium truncate">{marca}</p>
          <h3 className="text-sm font-semibold text-slate-800 line-clamp-2 leading-snug
                         group-hover:text-blue-700 transition-colors">
            {nombre_normalizado}
          </h3>
          {condicion_oferta && (
            <span className="text-xs text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full w-fit">
              {condicion_oferta}
            </span>
          )}
        </Link>

        {/* Precios + footer */}
        <div className="mt-auto pt-2 border-t border-slate-100">
          <Link href={`/producto/${producto_id}`} className="flex items-baseline gap-2">
            <span className="text-xs text-slate-400 line-through">
              ${precio_normal.toFixed(2)}
            </span>
            <span className="text-lg font-bold text-slate-900">
              ${precio_oferta.toFixed(2)}
            </span>
          </Link>

          {/* Fila de supermercado + acciones */}
          <div className="flex items-center gap-1 mt-1">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: supermercado_color }}
            />
            <span className="text-xs text-slate-500 truncate flex-1">
              {supermercado_nombre}
            </span>

            {/* Link externo a la tienda */}
            {url_producto && (
              <a
                href={url_producto}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                title="Ver en tienda"
                className="p-0.5 text-slate-300 hover:text-blue-500 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            {/* Botón agregar a canasta */}
            <button
              onClick={handleAgregar}
              title={agregado ? '¡Agregado!' : estaEnCanasta(producto_id) ? 'Ya en canasta — agregar más' : 'Agregar a canasta'}
              className={`p-0.5 transition-colors ${
                agregado ? 'text-blue-600' : 'text-slate-300 hover:text-blue-500'
              }`}
            >
              {agregado ? <Check className="w-3.5 h-3.5" /> : <ShoppingCart className="w-3.5 h-3.5" />}
            </button>

            {/* Botón compartir */}
            <button
              onClick={handleShare}
              title={copiado ? '¡Copiado!' : 'Compartir'}
              className={`p-0.5 transition-colors ${
                copiado ? 'text-emerald-500' : 'text-slate-300 hover:text-slate-500'
              }`}
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

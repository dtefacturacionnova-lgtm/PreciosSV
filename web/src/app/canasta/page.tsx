'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  ShoppingCart, Trash2, Plus, Minus, RefreshCw,
  Package, ArrowLeft, Sparkles, Trophy, AlertCircle,
  Scissors, Store,
} from 'lucide-react'
import { useCanasta } from '@/lib/canasta'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ItemResultado {
  producto_id: number
  nombre:      string
  imagen_url:  string | null
  precio:      number | null
  cantidad:    number
  disponible:  boolean
}

interface TiendaResultado {
  supermercado_id:        number
  supermercado_nombre:    string
  supermercado_corto:     string
  color:                  string
  total:                  number
  productos_disponibles:  number
  productos_total:        number
  cobertura_pct:          number
  items:                  ItemResultado[]
}

interface SplitSugerido {
  tienda_1:        string
  tienda_2:        string
  color_1:         string
  color_2:         string
  total:           number
  ahorro:          number
  items_tienda_1:  number
  items_tienda_2:  number
}

interface ResultadoCanasta {
  tiendas:           TiendaResultado[]
  ahorro_maximo:     number
  tienda_mas_barata: string | null
  split_sugerido:    SplitSugerido | null
}

// ─── Medalla de posición ──────────────────────────────────────────────────────

function Medalla({ pos }: { pos: number }) {
  if (pos === 0) return <span className="text-2xl">🥇</span>
  if (pos === 1) return <span className="text-2xl">🥈</span>
  if (pos === 2) return <span className="text-2xl">🥉</span>
  return <span className="text-base font-bold text-slate-400">#{pos + 1}</span>
}

// ─── Tarjeta de tienda en resultados ─────────────────────────────────────────

function TarjetaTienda({
  tienda,
  pos,
  totalMejor,
  expandida,
  onToggle,
}: {
  tienda:      TiendaResultado
  pos:         number
  totalMejor:  number
  expandida:   boolean
  onToggle:    () => void
}) {
  const esMejor    = pos === 0
  const ahorroVsMejor = pos > 0 ? +(tienda.total - totalMejor).toFixed(2) : 0
  const coberturaParcial = tienda.cobertura_pct < 100

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all ${
      esMejor
        ? 'border-emerald-200 bg-emerald-50 shadow-sm'
        : 'border-slate-100 bg-white shadow-sm'
    }`}>
      {/* Fila principal */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-5 py-4 text-left"
      >
        <Medalla pos={pos} />

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: tienda.color }}
          />
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 text-sm">
              {tienda.supermercado_nombre}
            </p>
            {coberturaParcial && (
              <p className="text-xs text-amber-600">
                Solo {tienda.productos_disponibles} de {tienda.productos_total} disponibles
              </p>
            )}
          </div>
        </div>

        <div className="text-right flex-shrink-0">
          <p className={`text-xl font-bold ${esMejor ? 'text-emerald-700' : 'text-slate-800'}`}>
            ${tienda.total.toFixed(2)}
          </p>
          {ahorroVsMejor > 0 && (
            <p className="text-xs text-red-500">
              +${ahorroVsMejor.toFixed(2)} más caro
            </p>
          )}
          {esMejor && !coberturaParcial && (
            <p className="text-xs font-medium text-emerald-600">Mejor precio</p>
          )}
        </div>

        <span className="text-slate-300 text-xs ml-1">
          {expandida ? '▲' : '▼'}
        </span>
      </button>

      {/* Detalle expandible */}
      {expandida && (
        <div className="border-t border-slate-100 divide-y divide-slate-50">
          {tienda.items.map(item => (
            <div key={item.producto_id} className={`flex items-center gap-3 px-5 py-2.5 ${!item.disponible ? 'opacity-40' : ''}`}>
              <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                {item.imagen_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={item.imagen_url} alt={item.nombre} className="max-h-7 max-w-7 object-contain" />
                  : <Package className="w-4 h-4 text-slate-300" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-700 truncate">{item.nombre}</p>
                <p className="text-xs text-slate-400">×{item.cantidad}</p>
              </div>
              <div className="text-right flex-shrink-0">
                {item.disponible && item.precio !== null ? (
                  <>
                    <p className="text-sm font-semibold text-slate-800">
                      ${(item.precio * item.cantidad).toFixed(2)}
                    </p>
                    <p className="text-xs text-slate-400">${item.precio.toFixed(2)} c/u</p>
                  </>
                ) : (
                  <p className="text-xs text-amber-600">No disponible</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function CanastaPage() {
  const { items, totalItems, agregar, actualizar, eliminar, limpiar } = useCanasta()
  const [resultado,  setResultado]  = useState<ResultadoCanasta | null>(null)
  const [calculando, setCalculando] = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [expandida,  setExpandida]  = useState<number | null>(0)

  const calcular = useCallback(async () => {
    if (items.length === 0) return
    setCalculando(true)
    setError(null)
    setResultado(null)
    setExpandida(0)

    try {
      const res = await fetch('/api/canasta', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          productos: items.map(i => ({ id: i.id, cantidad: i.cantidad })),
        }),
      })
      if (!res.ok) throw new Error()
      const data: ResultadoCanasta = await res.json()
      setResultado(data)
    } catch {
      setError('No se pudo calcular. Verifica tu conexión e intenta de nuevo.')
    } finally {
      setCalculando(false)
    }
  }, [items])

  // ── Estado vacío ────────────────────────────────────────────────

  if (items.length === 0) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-12">
        <div className="text-center">
          <ShoppingCart className="w-16 h-16 text-slate-200 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Tu canasta está vacía</h1>
          <p className="text-slate-500 mb-6">
            Agrega productos desde la búsqueda o desde las ofertas del día
            para comparar cuál supermercado tiene el total más barato.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/buscar"
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-2xl font-medium hover:bg-blue-700 transition-colors"
            >
              <Package className="w-4 h-4" />
              Buscar productos
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 text-slate-700 rounded-2xl font-medium hover:bg-slate-50 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Ver ofertas
            </Link>
          </div>
        </div>
      </main>
    )
  }

  // ── Canasta con items ────────────────────────────────────────────

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-blue-600" />
            Mi canasta
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {totalItems} {totalItems === 1 ? 'unidad' : 'unidades'} ·{' '}
            {items.length} {items.length === 1 ? 'producto' : 'productos'} distintos
          </p>
        </div>
        <button
          onClick={limpiar}
          className="text-xs text-red-400 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Vaciar
        </button>
      </div>

      {/* Lista de productos */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden mb-5">
        <div className="divide-y divide-slate-50">
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3">
              {/* Imagen */}
              <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
                {item.imagen_url
                  ? <Image
                      src={item.imagen_url}
                      alt={item.nombre}
                      width={36}
                      height={36}
                      className="object-contain max-h-8 max-w-8"
                    />
                  : <Package className="w-5 h-5 text-slate-300" />
                }
              </div>

              {/* Nombre → ver detalle */}
              <Link
                href={`/producto/${item.id}`}
                className="flex-1 min-w-0 hover:text-blue-600 transition-colors"
              >
                <p className="text-sm font-medium text-slate-800 truncate">{item.nombre}</p>
              </Link>

              {/* Cantidad */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => actualizar(item.id, item.cantidad - 1)}
                  className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
                >
                  <Minus className="w-3 h-3 text-slate-600" />
                </button>
                <span className="w-6 text-center text-sm font-semibold text-slate-800">
                  {item.cantidad}
                </span>
                <button
                  onClick={() => actualizar(item.id, item.cantidad + 1)}
                  className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
                >
                  <Plus className="w-3 h-3 text-slate-600" />
                </button>
              </div>

              {/* Eliminar */}
              <button
                onClick={() => eliminar(item.id)}
                className="p-1.5 text-slate-300 hover:text-red-400 hover:bg-red-50 rounded-lg transition-colors ml-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Botón calcular */}
      <button
        onClick={calcular}
        disabled={calculando}
        className="w-full flex items-center justify-center gap-2.5 py-4 bg-blue-600 text-white rounded-2xl font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-60 mb-6 shadow-sm"
      >
        {calculando ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            Calculando precios…
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            ¿Dónde me conviene comprar?
          </>
        )}
      </button>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3 mb-5">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Resultados */}
      {resultado && !calculando && (
        <div className="space-y-4">

          {/* Encabezado de resultados */}
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            <h2 className="text-base font-bold text-slate-800">
              Ranking por precio total
            </h2>
          </div>

          {resultado.tiendas.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center">
              <Store className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-500 text-sm">
                No encontramos precios para estos productos.
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Puede que aún no estén en nuestra base de datos.
              </p>
            </div>
          ) : (
            <>
              {/* Banner de ahorro */}
              {resultado.ahorro_maximo > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-3 flex items-center gap-3">
                  <Sparkles className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <p className="text-sm text-emerald-700">
                    <strong>Puedes ahorrar hasta ${resultado.ahorro_maximo.toFixed(2)}</strong>
                    {' '}comprando en {resultado.tienda_mas_barata}
                  </p>
                </div>
              )}

              {/* Tarjetas de tiendas */}
              <div className="space-y-3">
                {resultado.tiendas.map((tienda, idx) => (
                  <TarjetaTienda
                    key={tienda.supermercado_id}
                    tienda={tienda}
                    pos={idx}
                    totalMejor={resultado.tiendas[0].total}
                    expandida={expandida === idx}
                    onToggle={() => setExpandida(prev => prev === idx ? null : idx)}
                  />
                ))}
              </div>

              {/* Sugerencia de split */}
              {resultado.split_sugerido && (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl px-5 py-4">
                  <div className="flex items-start gap-3">
                    <Scissors className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-blue-800 mb-1">
                        Compra dividida — ahorra ${resultado.split_sugerido.ahorro.toFixed(2)} más
                      </p>
                      <p className="text-xs text-blue-700">
                        Compra{' '}
                        <strong>{resultado.split_sugerido.items_tienda_1} producto{resultado.split_sugerido.items_tienda_1 !== 1 ? 's' : ''}</strong>
                        {' '}en {resultado.split_sugerido.tienda_1} y{' '}
                        <strong>{resultado.split_sugerido.items_tienda_2} producto{resultado.split_sugerido.items_tienda_2 !== 1 ? 's' : ''}</strong>
                        {' '}en {resultado.split_sugerido.tienda_2}.
                        Total estimado:{' '}
                        <strong>${resultado.split_sugerido.total.toFixed(2)}</strong>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <p className="text-xs text-center text-slate-400 pt-2">
                Precios actualizados hace menos de 12h · Solo considera productos disponibles en tienda
              </p>
            </>
          )}
        </div>
      )}
    </main>
  )
}

'use client'

/**
 * CategoriaProductos — client component que muestra los productos de una categoría.
 * Carga dos secciones:
 *  1. Mejores ofertas (en_oferta=true, ordenadas por descuento)
 *  2. Todos los productos (ordenados por precio_min asc)
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Flame, RefreshCw, PackageSearch, SlidersHorizontal } from 'lucide-react'
import TarjetaProductoBusqueda from '@/components/TarjetaProductoBusqueda'

interface Producto {
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

interface Props {
  slug:        string
  categoriaId: number
}

export default function CategoriaProductos({ slug }: Props) {
  const [ofertas,   setOfertas]   = useState<Producto[]>([])
  const [todos,     setTodos]     = useState<Producto[]>([])
  const [cargando,  setCargando]  = useState(true)
  const [orden,     setOrden]     = useState<'precio_asc' | 'precio_desc' | 'descuento'>('precio_asc')
  const [pagina,    setPagina]    = useState(1)
  const [totalPags, setTotalPags] = useState(1)

  useEffect(() => {
    setCargando(true)
    const qsOfertas = new URLSearchParams({ categoria: slug, solo_ofertas: 'true', orden: 'descuento', page: '1', limit: '6' })
    const qsTodos   = new URLSearchParams({ categoria: slug, orden, page: String(pagina) })

    Promise.all([
      fetch(`/api/buscar?${qsOfertas}`).then(r => r.json()),
      fetch(`/api/buscar?${qsTodos}`).then(r => r.json()),
    ]).then(([ofertasData, todosData]) => {
      setOfertas(ofertasData.resultados ?? [])
      setTodos(todosData.resultados ?? [])
      setTotalPags(todosData.pages ?? 1)
    }).catch(console.error)
      .finally(() => setCargando(false))
  }, [slug, orden, pagina])

  if (cargando) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-slate-400">
        <RefreshCw className="w-5 h-5 animate-spin" />
        <p className="text-sm">Cargando productos…</p>
      </div>
    )
  }

  return (
    <div className="space-y-10">

      {/* Sección: Mejores ofertas */}
      {ofertas.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Flame className="w-4 h-4 text-amber-500" />
            <h2 className="text-base font-bold text-slate-800">Mejores ofertas ahora</h2>
          </div>
          <div className="flex flex-col gap-3">
            {ofertas.map(p => (
              <TarjetaProductoBusqueda key={p.id} {...p} />
            ))}
          </div>
          <Link
            href={`/buscar?categoria=${slug}&solo_ofertas=true`}
            className="mt-3 inline-block text-xs text-blue-600 hover:underline"
          >
            Ver todas las ofertas →
          </Link>
        </section>
      )}

      {/* Sección: Todos los productos */}
      <section>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-base font-bold text-slate-800">
            Todos los productos
          </h2>
          {/* Ordenar */}
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={orden}
              onChange={e => { setOrden(e.target.value as any); setPagina(1) }}
              className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              <option value="precio_asc">Precio: menor a mayor</option>
              <option value="precio_desc">Precio: mayor a menor</option>
              <option value="descuento">Mayor descuento</option>
            </select>
          </div>
        </div>

        {todos.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <PackageSearch className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p>No encontramos productos en esta categoría</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              {todos.map(p => (
                <TarjetaProductoBusqueda key={p.id} {...p} />
              ))}
            </div>

            {/* Paginación */}
            {totalPags > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6">
                <button
                  disabled={pagina <= 1}
                  onClick={() => setPagina(p => p - 1)}
                  className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ← Anterior
                </button>
                <span className="text-sm text-slate-500">
                  Pág {pagina} de {totalPags}
                </span>
                <button
                  disabled={pagina >= totalPags}
                  onClick={() => setPagina(p => p + 1)}
                  className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Siguiente →
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

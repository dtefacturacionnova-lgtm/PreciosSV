'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Search, SlidersHorizontal, RefreshCw, PackageSearch } from 'lucide-react'
import FiltrosBusqueda from '@/components/FiltrosBusqueda'
import TarjetaProductoBusqueda from '@/components/TarjetaProductoBusqueda'
import clsx from 'clsx'

interface ResultadoBusqueda {
  id: number
  nombre_normalizado: string
  marca: string | null
  imagen_url: string | null
  categoria_nombre: string | null
  precio_min: number | null
  precio_max: number | null
  en_oferta: boolean
  descuento_max: number | null
  tiendas: number
  supermercado_mas_barato: string | null
  color_mas_barato: string | null
}

interface RespuestaBusqueda {
  resultados: ResultadoBusqueda[]
  total: number
  page: number
  pages: number
}

function PaginadorBtn({
  children,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'min-w-9 h-9 px-3 rounded-lg text-sm font-medium transition-colors',
        active
          ? 'bg-blue-600 text-white'
          : disabled
          ? 'text-slate-300 cursor-not-allowed'
          : 'text-slate-600 hover:bg-slate-100'
      )}
    >
      {children}
    </button>
  )
}

function BuscadorContent() {
  const params = useSearchParams()
  const router = useRouter()

  const q           = params.get('q') ?? ''
  const categoria   = params.get('categoria') ?? ''
  const supermercado = params.get('supermercado') ?? ''
  const soloOfertas = params.get('solo_ofertas') === 'true'
  const orden       = params.get('orden') ?? 'relevancia'
  const page        = Math.max(1, parseInt(params.get('page') ?? '1'))

  const [data, setData]         = useState<RespuestaBusqueda | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [inputQ, setInputQ]     = useState(q)

  const buscar = useCallback(async () => {
    if (!q && !categoria && !supermercado && !soloOfertas) {
      setData(null)
      return
    }
    setCargando(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (q)            qs.set('q', q)
      if (categoria)    qs.set('categoria', categoria)
      if (supermercado) qs.set('supermercado', supermercado)
      if (soloOfertas)  qs.set('solo_ofertas', 'true')
      if (orden !== 'relevancia') qs.set('orden', orden)
      qs.set('page', String(page))

      const res = await fetch(`/api/buscar?${qs.toString()}`)
      if (!res.ok) throw new Error('Error al buscar')
      const json: RespuestaBusqueda = await res.json()
      setData(json)
    } catch {
      setError('No se pudo completar la búsqueda. Intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }, [q, categoria, supermercado, soloOfertas, orden, page])

  useEffect(() => {
    buscar()
  }, [buscar])

  useEffect(() => {
    setInputQ(q)
  }, [q])

  const irPagina = (p: number) => {
    const next = new URLSearchParams(params.toString())
    next.set('page', String(p))
    router.push(`/buscar?${next.toString()}`)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const next = new URLSearchParams(params.toString())
    if (inputQ.trim()) next.set('q', inputQ.trim())
    else next.delete('q')
    next.delete('page')
    router.push(`/buscar?${next.toString()}`)
  }

  const sinFiltros = !q && !categoria && !supermercado && !soloOfertas

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">

      {/* Barra de búsqueda */}
      <form onSubmit={handleSubmit} className="mb-6">
        <div className="relative max-w-2xl mx-auto">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
          <input
            type="search"
            value={inputQ}
            onChange={e => setInputQ(e.target.value)}
            placeholder="Busca productos, marcas…"
            className="w-full pl-12 pr-4 py-3.5 rounded-2xl border border-slate-200 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-800 placeholder:text-slate-400"
          />
          <button
            type="submit"
            className="absolute right-3 top-1/2 -translate-y-1/2 bg-blue-600 text-white text-sm font-medium px-4 py-1.5 rounded-xl hover:bg-blue-700 transition-colors"
          >
            Buscar
          </button>
        </div>
      </form>

      {/* Layout principal */}
      <div className="flex gap-6 items-start">

        {/* Sidebar filtros */}
        <FiltrosBusqueda />

        {/* Resultados */}
        <div className="flex-1 min-w-0">

          {/* Pantalla inicial sin búsqueda */}
          {sinFiltros && !cargando && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <PackageSearch className="w-12 h-12 text-slate-300 mb-4" />
              <p className="text-slate-500 font-medium">¿Qué producto buscas?</p>
              <p className="text-sm text-slate-400 mt-1">
                Ingresa un nombre, marca o filtra por categoría
              </p>
            </div>
          )}

          {/* Cargando */}
          {cargando && (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin" />
              <p className="text-sm">Buscando productos…</p>
            </div>
          )}

          {/* Error */}
          {error && !cargando && (
            <div className="bg-red-50 border border-red-100 rounded-2xl p-6 text-center">
              <p className="text-red-600 text-sm">{error}</p>
              <button
                onClick={buscar}
                className="mt-3 text-xs text-red-500 underline hover:no-underline"
              >
                Reintentar
              </button>
            </div>
          )}

          {/* Resultados */}
          {!cargando && !error && data && (
            <>
              {/* Header de resultados */}
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-slate-500">
                  {data.total === 0 ? (
                    'Sin resultados'
                  ) : (
                    <>
                      <span className="font-semibold text-slate-800">{data.total}</span>
                      {' '}producto{data.total !== 1 ? 's' : ''}
                      {q && <> para <span className="font-semibold text-slate-800">"{q}"</span></>}
                    </>
                  )}
                </p>
                <div className="flex items-center gap-1 text-xs text-slate-400">
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  Página {data.page} de {data.pages || 1}
                </div>
              </div>

              {/* Sin resultados */}
              {data.resultados.length === 0 && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
                  <PackageSearch className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="font-medium text-slate-600">No encontramos resultados</p>
                  <p className="text-sm text-slate-400 mt-1">
                    Prueba con otro término o elimina algunos filtros
                  </p>
                </div>
              )}

              {/* Grid de resultados */}
              {data.resultados.length > 0 && (
                <div className="flex flex-col gap-3">
                  {data.resultados.map(r => (
                    <TarjetaProductoBusqueda key={r.id} {...r} />
                  ))}
                </div>
              )}

              {/* Paginación */}
              {data.pages > 1 && (
                <div className="flex items-center justify-center gap-1 mt-8">
                  <PaginadorBtn
                    disabled={data.page <= 1}
                    onClick={() => irPagina(data.page - 1)}
                  >
                    ‹
                  </PaginadorBtn>

                  {Array.from({ length: data.pages }, (_, i) => i + 1)
                    .filter(p =>
                      p === 1 ||
                      p === data.pages ||
                      Math.abs(p - data.page) <= 2
                    )
                    .reduce<(number | '...')[]>((acc, p, i, arr) => {
                      if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...')
                      acc.push(p)
                      return acc
                    }, [])
                    .map((p, i) =>
                      p === '...' ? (
                        <span key={`ellipsis-${i}`} className="px-2 text-slate-400 text-sm">…</span>
                      ) : (
                        <PaginadorBtn
                          key={p}
                          active={p === data.page}
                          onClick={() => irPagina(p as number)}
                        >
                          {p}
                        </PaginadorBtn>
                      )
                    )}

                  <PaginadorBtn
                    disabled={data.page >= data.pages}
                    onClick={() => irPagina(data.page + 1)}
                  >
                    ›
                  </PaginadorBtn>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function BuscarPage() {
  return (
    <Suspense fallback={
      <div className="max-w-7xl mx-auto px-4 py-20 flex justify-center">
        <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    }>
      <BuscadorContent />
    </Suspense>
  )
}

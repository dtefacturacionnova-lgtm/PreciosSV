'use client'

import { useEffect, useState, useCallback } from 'react'
import { Flame, RefreshCw } from 'lucide-react'
import TarjetaOferta from '@/components/TarjetaOferta'
import FiltrosSupermercado from '@/components/FiltrosSupermercado'
import SeccionB2B from '@/components/SeccionB2B'
import type { OfertaDelDia } from '@/types/database'

const MOCK_OFERTAS: OfertaDelDia[] = [
  { producto_id: 1, nombre_normalizado: 'Leche Entera LALA 1L',        marca: 'LALA',      imagen_url: null, precio_normal: 2.75, precio_oferta: 1.99, descuento_pct: 27.6, condicion_oferta: null,  supermercado_id: 1, supermercado_nombre: 'Súper Selectos', supermercado_key: 'selectos',     supermercado_color: '#DC2626', categoria_nombre: 'Lácteos' },
  { producto_id: 2, nombre_normalizado: 'Aceite Vegetal La Yaya 1L',    marca: 'La Yaya',   imagen_url: null, precio_normal: 4.50, precio_oferta: 3.25, descuento_pct: 27.8, condicion_oferta: null,  supermercado_id: 2, supermercado_nombre: 'Walmart',        supermercado_key: 'walmart',      supermercado_color: '#1D4ED8', categoria_nombre: 'Abarrotes' },
  { producto_id: 3, nombre_normalizado: 'Arroz Superior Calsa 5 lb',    marca: 'Calsa',     imagen_url: null, precio_normal: 5.99, precio_oferta: 4.49, descuento_pct: 25.0, condicion_oferta: null,  supermercado_id: 3, supermercado_nombre: 'Don Juan',       supermercado_key: 'donjuan',      supermercado_color: '#16A34A', categoria_nombre: 'Abarrotes' },
  { producto_id: 4, nombre_normalizado: 'Frijoles Rojos Conacaste 2 lb',marca: 'Conacaste', imagen_url: null, precio_normal: 3.25, precio_oferta: 2.45, descuento_pct: 24.6, condicion_oferta: '2x1', supermercado_id: 4, supermercado_nombre: 'Maxi Despensa', supermercado_key: 'maxidespensa',  supermercado_color: '#EA580C', categoria_nombre: 'Abarrotes' },
  { producto_id: 5, nombre_normalizado: 'Azúcar Blanca Central 1 kg',   marca: 'Central',   imagen_url: null, precio_normal: 1.99, precio_oferta: 1.49, descuento_pct: 25.1, condicion_oferta: null,  supermercado_id: 5, supermercado_nombre: 'Familiar',       supermercado_key: 'familiar',     supermercado_color: '#7C3AED', categoria_nombre: 'Abarrotes' },
  { producto_id: 6, nombre_normalizado: 'Detergente Líquido Rinso 1L',  marca: 'Rinso',     imagen_url: null, precio_normal: 6.50, precio_oferta: 4.75, descuento_pct: 26.9, condicion_oferta: null,  supermercado_id: 1, supermercado_nombre: 'Súper Selectos', supermercado_key: 'selectos',     supermercado_color: '#DC2626', categoria_nombre: 'Limpieza' },
  { producto_id: 7, nombre_normalizado: 'Jabón Dove Barra 90g',         marca: 'Dove',      imagen_url: null, precio_normal: 1.25, precio_oferta: 0.89, descuento_pct: 28.8, condicion_oferta: null,  supermercado_id: 2, supermercado_nombre: 'Walmart',        supermercado_key: 'walmart',      supermercado_color: '#1D4ED8', categoria_nombre: 'Personal' },
  { producto_id: 8, nombre_normalizado: 'Pasta Dental Colgate 150ml',   marca: 'Colgate',   imagen_url: null, precio_normal: 2.10, precio_oferta: 1.59, descuento_pct: 24.3, condicion_oferta: null,  supermercado_id: 3, supermercado_nombre: 'Don Juan',       supermercado_key: 'donjuan',      supermercado_color: '#16A34A', categoria_nombre: 'Personal' },
]

const STATS = [
  { valor: '1,240+', etiqueta: 'productos' },
  { valor: '5',      etiqueta: 'supermercados' },
  { valor: 'Hoy',    etiqueta: 'actualizado', destacado: true },
]

export default function HomePage() {
  const [filtroActivo, setFiltroActivo] = useState('todos')
  const [ofertas, setOfertas] = useState<OfertaDelDia[]>(MOCK_OFERTAS)
  const [cargando, setCargando] = useState(false)
  const [usandoMock, setUsandoMock] = useState(true)

  const cargarOfertas = useCallback(async (supermercado: string) => {
    setCargando(true)
    try {
      const params = new URLSearchParams({ supermercado, limit: '24' })
      const res = await fetch(`/api/ofertas?${params}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      if (data.ofertas?.length > 0) {
        setOfertas(data.ofertas)
        setUsandoMock(false)
      } else {
        throw new Error()
      }
    } catch {
      const mockFiltrado = supermercado === 'todos'
        ? MOCK_OFERTAS
        : MOCK_OFERTAS.filter(o => o.supermercado_key === supermercado)
      setOfertas(mockFiltrado)
      setUsandoMock(true)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargarOfertas(filtroActivo) }, [filtroActivo, cargarOfertas])

  return (
    <main>
      {/* Hero */}
      <section className="bg-gradient-to-b from-slate-100 to-white pt-10 pb-6 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col lg:flex-row lg:items-end gap-6 lg:gap-16">
            <div className="flex-1">
              <div className="inline-flex items-center gap-2 mb-4 px-3 py-1.5 rounded-full bg-amber-100 border border-amber-200">
                <Flame className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-semibold text-amber-700">Ofertas del día</span>
              </div>
              <h1 className="text-4xl lg:text-5xl font-bold text-slate-900 leading-tight">
                Compara precios.<br />
                <span className="text-[#1E40AF]">Ahorra más.</span>
              </h1>
            </div>
            <div className="lg:pb-2">
              <p className="text-sm text-slate-500">
                Compara precios en los 5 supermercados de El Salvador
              </p>
              <div className="flex items-center gap-4 mt-2">
                {STATS.map(({ valor, etiqueta, destacado }) => (
                  <span key={etiqueta} className="flex items-baseline gap-1">
                    <strong className={`font-bold text-sm ${destacado ? 'text-[#059669]' : 'text-slate-800'}`}>{valor}</strong>
                    <span className="text-xs text-slate-400">{etiqueta}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-6">
            <FiltrosSupermercado activo={filtroActivo} onChange={setFiltroActivo} />
          </div>
        </div>
      </section>

      {/* Grid de productos */}
      <section className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Mejores ofertas de hoy</h2>
            {usandoMock && (
              <p className="text-xs text-amber-600 mt-0.5">
                Vista previa — conecta Supabase para datos reales
              </p>
            )}
          </div>
          <span className="text-sm text-slate-400">
            {cargando
              ? <RefreshCw className="w-4 h-4 animate-spin inline" />
              : `Mostrando ${ofertas.length} productos`}
          </span>
        </div>

        {cargando ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-100 overflow-hidden animate-pulse">
                <div className="bg-slate-100 aspect-square" />
                <div className="p-3 space-y-2">
                  <div className="h-3 bg-slate-100 rounded w-1/2" />
                  <div className="h-4 bg-slate-100 rounded w-3/4" />
                  <div className="h-5 bg-slate-100 rounded w-1/3 mt-3" />
                </div>
              </div>
            ))}
          </div>
        ) : ofertas.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-lg">No hay ofertas activas para este filtro</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {ofertas.map(oferta => (
              <TarjetaOferta key={`${oferta.producto_id}-${oferta.supermercado_id}`} oferta={oferta} />
            ))}
          </div>
        )}
      </section>

      {/* B2B */}
      <SeccionB2B />
    </main>
  )
}

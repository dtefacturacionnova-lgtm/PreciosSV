'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Bell, Package, RefreshCw,
  ChevronRight, BarChart2
} from 'lucide-react'
import ComparativaPrecios from '@/components/ComparativaPrecios'
import HistoricoChart from '@/components/HistoricoChart'

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

interface Producto {
  id: number
  nombre_normalizado: string
  marca: string | null
  imagen_url: string | null
  ean: string | null
  unidad: string | null
  cantidad: number | null
  categorias: { nombre: string; slug: string } | null
}

interface PuntoHistorico {
  fecha: string
  precio_efectivo: number
  supermercado_nombre: string
  supermercado_key: string
  supermercado_color: string
}

type Tab = 'comparativa' | 'historico'

export default function ProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [producto, setProducto] = useState<Producto | null>(null)
  const [precios, setPrecios] = useState<PrecioSuper[]>([])
  const [historico, setHistorico] = useState<PuntoHistorico[]>([])
  const [tab, setTab] = useState<Tab>('comparativa')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function cargar() {
      setCargando(true)
      try {
        const res = await fetch(`/api/productos/${id}/comparativa`)
        if (!res.ok) throw new Error('Producto no encontrado')
        const data = await res.json()
        setProducto(data.producto)
        setPrecios(data.precios)
      } catch (e: any) {
        setError(e.message)
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [id])

  // Cargar historial cuando se cambia a esa pestaña
  useEffect(() => {
    if (tab !== 'historico' || historico.length) return
    fetch(`/api/productos/${id}/historico?dias=30`)
      .then(r => r.json())
      .then(d => setHistorico(d.historico ?? []))
      .catch(() => {})
  }, [tab, id, historico.length])

  const precioMin = precios[0]?.precio_efectivo
  const superMasBato = precios[0]?.supermercado_nombre
  const superColor = precios[0]?.supermercado_color

  if (cargando) return <PaginaCargando />
  if (error || !producto) return <PaginaError mensaje={error ?? 'Producto no encontrado'} />

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-slate-400 mb-6">
        <Link href="/" className="hover:text-slate-600 flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Ofertas del día
        </Link>
        <ChevronRight className="w-3 h-3" />
        {producto.categorias && (
          <>
            <span>{producto.categorias.nombre}</span>
            <ChevronRight className="w-3 h-3" />
          </>
        )}
        <span className="text-slate-600 truncate max-w-xs">{producto.nombre_normalizado}</span>
      </nav>

      {/* Header del producto */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mb-6">
        <div className="flex flex-col sm:flex-row gap-5">

          {/* Imagen */}
          <div className="w-full sm:w-36 h-36 flex-shrink-0 bg-slate-50 rounded-xl flex items-center justify-center">
            {producto.imagen_url ? (
              <img
                src={producto.imagen_url}
                alt={producto.nombre_normalizado}
                className="max-h-28 max-w-full object-contain"
              />
            ) : (
              <Package className="w-12 h-12 text-slate-300" />
            )}
          </div>

          {/* Info */}
          <div className="flex-1 flex flex-col gap-2">
            {producto.marca && (
              <span className="text-sm font-medium text-slate-400">{producto.marca}</span>
            )}
            <h1 className="text-xl font-bold text-slate-900 leading-snug">
              {producto.nombre_normalizado}
            </h1>

            <div className="flex flex-wrap gap-2 text-xs text-slate-400">
              {producto.categorias && (
                <span className="bg-slate-100 px-2 py-1 rounded-full">
                  {producto.categorias.nombre}
                </span>
              )}
              {producto.cantidad && producto.unidad && (
                <span className="bg-slate-100 px-2 py-1 rounded-full">
                  {producto.cantidad} {producto.unidad}
                </span>
              )}
              {producto.ean && (
                <span className="bg-slate-100 px-2 py-1 rounded-full font-mono">
                  EAN: {producto.ean}
                </span>
              )}
            </div>

            {/* Mejor precio resumen */}
            {precioMin && (
              <div className="mt-auto flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100">
                <div>
                  <p className="text-xs text-slate-400">Mejor precio actual</p>
                  <p className="text-2xl font-bold text-slate-900">
                    ${precioMin.toFixed(2)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: superColor }}
                  />
                  <span className="text-sm text-slate-600">{superMasBato}</span>
                </div>
                <button className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-full border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                  <Bell className="w-4 h-4" />
                  Crear alerta
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl mb-5 w-fit">
        <TabBtn active={tab === 'comparativa'} onClick={() => setTab('comparativa')}>
          Comparativa de precios
        </TabBtn>
        <TabBtn active={tab === 'historico'} onClick={() => setTab('historico')}>
          <BarChart2 className="w-4 h-4" />
          Historial
        </TabBtn>
      </div>

      {/* Contenido del tab */}
      {tab === 'comparativa' ? (
        <ComparativaPrecios precios={precios} />
      ) : (
        <HistoricoChart historico={historico} dias={30} />
      )}

    </div>
  )
}

// ── Sub-componentes locales ──────────────────────────────────

function TabBtn({
  active, onClick, children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        active
          ? 'bg-white text-slate-900 shadow-sm'
          : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  )
}

function PaginaCargando() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-12 flex flex-col items-center gap-3 text-slate-400">
      <RefreshCw className="w-6 h-6 animate-spin" />
      <p className="text-sm">Cargando comparativa...</p>
    </div>
  )
}

function PaginaError({ mensaje }: { mensaje: string }) {
  return (
    <div className="max-w-5xl mx-auto px-4 py-12 text-center">
      <p className="text-slate-500 mb-4">{mensaje}</p>
      <Link href="/" className="text-blue-600 hover:underline text-sm">
        ← Volver a las ofertas
      </Link>
    </div>
  )
}

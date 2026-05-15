'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Package, Tag, Store, TrendingDown,
  RefreshCw, Building2, BarChart2, ShoppingBag,
  ShieldCheck, LineChart, Lightbulb, BookOpen,
} from 'lucide-react'
import MetricaCard from '@/components/proveedores/MetricaCard'
import TablaProductos from '@/components/proveedores/TablaProductos'
import CumplimientoPrecios from '@/components/proveedores/CumplimientoPrecios'
import InteligenciaMercado from '@/components/proveedores/InteligenciaMercado'
import RecomendacionesPrecio from '@/components/proveedores/RecomendacionesPrecio'
import MiCatalogo from '@/components/proveedores/MiCatalogo'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Metrica {
  productos_activos:     number
  productos_con_precio:  number
  ofertas_activas:       number
  tiendas_presencia:     number
  descuento_promedio:    number | null
}

interface DashboardData {
  proveedor: { razon_social: string; marcas: string[] }
  metricas:  Metrica
  tabla:     any[]
}

type Tab = 'catalogo' | 'cumplimiento' | 'mercado' | 'recomendaciones' | 'micatalogo'

// ─── Sub-componente: barra de cobertura ──────────────────────────────────────

function CoberturaBarra({ label, valor, max, color }: {
  label: string; valor: number; max: number; color: string
}) {
  const pct = max > 0 ? Math.round((valor / max) * 100) : 0
  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm text-slate-600">{label}</span>
        <span className="text-sm font-semibold text-slate-800">
          {valor} <span className="text-slate-400 font-normal text-xs">/ {max}</span>
        </span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

// ─── Tab: Catálogo ───────────────────────────────────────────────────────────

function TabCatalogo({ metricas, tabla }: { metricas: Metrica; tabla: any[] }) {
  const SUPERMERCADOS_TOTALES = 5

  return (
    <>
      {/* Cobertura + estado */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">

        <div className="md:col-span-1 bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-700">Presencia por cadena</h2>
          </div>
          {(() => {
            const conteo: Record<string, { nombre: string; color: string; count: number }> = {}
            for (const prod of tabla) {
              for (const p of prod.precios_por_tienda) {
                if (!conteo[p.key]) conteo[p.key] = { nombre: p.supermercado, color: p.color, count: 0 }
                conteo[p.key].count++
              }
            }
            const entradas = Object.values(conteo).sort((a, b) => b.count - a.count)
            const maxCount = entradas[0]?.count ?? 1
            return entradas.length ? (
              entradas.map(e => (
                <CoberturaBarra key={e.nombre} label={e.nombre} valor={e.count} max={maxCount} color={e.color} />
              ))
            ) : (
              <p className="text-xs text-slate-400">Sin datos de tiendas aún</p>
            )
          })()}
        </div>

        <div className="md:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-700">Estado del catálogo</h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              {
                label: 'Con precio registrado',
                valor: metricas.productos_con_precio,
                total: metricas.productos_activos,
                color: '#1D4ED8',
              },
              {
                label: 'En oferta ahora',
                valor: metricas.ofertas_activas,
                total: metricas.productos_activos * metricas.tiendas_presencia || 1,
                color: '#F59E0B',
              },
            ].map(item => {
              const pct = item.total > 0 ? Math.round((item.valor / item.total) * 100) : 0
              return (
                <div key={item.label} className="bg-slate-50 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-2">{item.label}</p>
                  <p className="text-2xl font-bold" style={{ color: item.color }}>{item.valor}</p>
                  <div className="mt-2 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: item.color }} />
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{pct}% del total</p>
                </div>
              )
            })}
          </div>
          {metricas.descuento_promedio && (
            <div className="mt-4 bg-amber-50 border border-amber-100 rounded-xl p-4 flex items-center gap-3">
              <TrendingDown className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  Descuento promedio: {metricas.descuento_promedio}%
                </p>
                <p className="text-xs text-amber-600">
                  Sobre {metricas.ofertas_activas} oferta{metricas.ofertas_activas !== 1 ? 's' : ''} activa{metricas.ofertas_activas !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabla de productos */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700">
            Catálogo de productos ({tabla.length})
          </h2>
          <p className="text-xs text-slate-400">Haz clic en una fila para ver precios por tienda</p>
        </div>
        <TablaProductos productos={tabla} />
      </div>
    </>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function DashboardProveedorPage() {
  const [data,     setData]     = useState<DashboardData | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [tab,      setTab]      = useState<Tab>('catalogo')

  useEffect(() => {
    fetch('/api/proveedores/dashboard')
      .then(async res => {
        if (!res.ok) throw new Error('ERROR')
        return res.json()
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setCargando(false))
  }, [])

  // ── Estados de error ───────────────────────────────────────────
  if (cargando) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-20 flex flex-col items-center gap-3 text-slate-400">
        <RefreshCw className="w-6 h-6 animate-spin" />
        <p className="text-sm">Cargando dashboard…</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <p className="text-slate-500 text-sm mb-4">No se pudo cargar el dashboard.</p>
        <Link href="/" className="text-blue-600 text-sm hover:underline">← Volver al inicio</Link>
      </div>
    )
  }

  const { proveedor, metricas, tabla } = data

  // ── Tabs config ────────────────────────────────────────────────
  const TABS: { id: Tab; label: string; icon: typeof ShoppingBag; desc: string }[] = [
    { id: 'micatalogo',       label: 'Mi Catálogo',             icon: BookOpen,     desc: 'Registra tus productos con EAN y mapea competidores equivalentes' },
    { id: 'catalogo',         label: 'Mercado',                 icon: ShoppingBag,  desc: 'Precios actuales de tus marcas en supermercados' },
    { id: 'cumplimiento',     label: 'Cumplimiento PVP',        icon: ShieldCheck,  desc: 'Verifica que los supers respeten tu precio sugerido' },
    { id: 'mercado',          label: 'Inteligencia',            icon: LineChart,     desc: 'Compara tus marcas vs. competidores' },
    { id: 'recomendaciones',  label: 'Recomendaciones',         icon: Lightbulb,    desc: 'Recomendaciones inteligentes de pricing basadas en el mercado' },
  ]

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
          <Building2 className="w-3.5 h-3.5" />
          Panel de Proveedor
        </div>
        <h1 className="text-2xl font-bold text-slate-900">{proveedor.razon_social}</h1>
        {proveedor.marcas.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {proveedor.marcas.map(m => (
              <span key={m} className="text-xs bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full font-medium">
                {m}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Métricas globales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricaCard
          icono={ShoppingBag}
          label="Productos activos"
          valor={metricas.productos_activos}
          sub={`${metricas.productos_con_precio} con precio`}
          color="blue"
        />
        <MetricaCard
          icono={Tag}
          label="Ofertas vigentes"
          valor={metricas.ofertas_activas}
          sub="en todos los supers"
          color="amber"
        />
        <MetricaCard
          icono={Store}
          label="Tiendas con presencia"
          valor={`${metricas.tiendas_presencia} / 5`}
          color="emerald"
        />
        <MetricaCard
          icono={TrendingDown}
          label="Descuento promedio"
          valor={metricas.descuento_promedio ? `${metricas.descuento_promedio}%` : '—'}
          sub="en ofertas activas"
          color="slate"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-2xl p-1 mb-6">
        {TABS.map(t => {
          const Icono = t.icon
          const activo = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`
                flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all
                ${activo
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'}
              `}
            >
              <Icono className="w-4 h-4 flex-shrink-0" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* Descripción del tab activo */}
      {(() => {
        const t = TABS.find(t => t.id === tab)
        return t ? (
          <p className="text-xs text-slate-400 mb-4">{t.desc}</p>
        ) : null
      })()}

      {/* Contenido del tab */}
      {tab === 'micatalogo'      && <MiCatalogo />}
      {tab === 'catalogo'        && <TabCatalogo metricas={metricas} tabla={tabla} />}
      {tab === 'cumplimiento'    && <CumplimientoPrecios />}
      {tab === 'mercado'         && <InteligenciaMercado />}
      {tab === 'recomendaciones' && <RecomendacionesPrecio />}

    </div>
  )
}

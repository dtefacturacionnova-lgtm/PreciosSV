'use client'

/**
 * /proveedores/reporte
 * Página de reporte ejecutivo para exportar a PDF via window.print().
 * Agrupa: métricas globales, cumplimiento PVP, riesgo, alertas, tendencias.
 * Estilos de impresión controlados por @media print en globals.css vía className.
 */
import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, Printer, ArrowLeft, ShieldCheck, AlertTriangle, TrendingDown, BarChart2, Tag, TrendingUp } from 'lucide-react'
import Link from 'next/link'

// ─── Types (simplificados para el reporte) ────────────────────────────────────

interface DashData {
  proveedor: { razon_social: string; marcas: string[] }
  metricas: {
    productos_activos:    number
    productos_con_precio: number
    ofertas_activas:      number
    tiendas_presencia:    number
    descuento_promedio:   number | null
  }
}

interface CumplimientoTienda {
  supermercado:    string
  precio_efectivo: number
  desviacion_pct:  number | null
  estado:          'alto' | 'bajo' | 'ok' | 'sin_datos'
}

interface CumplimientoItem {
  catalogo_id:  number
  nombre:       string
  marca:        string | null
  pvp_sugerido: number | null
  tiendas:      CumplimientoTienda[]
}

interface CumplimientoData {
  resumen_global: {
    total_ok:       number
    total_alto:     number
    total_bajo:     number
    total_sin_datos: number
  }
  productos: CumplimientoItem[]
}

interface RiesgoResumen {
  riesgo_alto:   number
  riesgo_medio:  number
  riesgo_bajo:   number
  ventaja:       number
  sin_datos:     number
  alertas_dumping: number
}

interface CategoriaStat {
  nombre:          string
  total_productos: number
  mis_productos:   number
  share_pct:       number
  indice_precio:   number | null
  oferta_pct:      number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function EstadoBadge({ estado }: { estado: string }) {
  if (estado === 'alto') return <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded">Por encima +5%</span>
  if (estado === 'bajo') return <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded">Por debajo -5%</span>
  if (estado === 'ok')   return <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">✓ Cumple</span>
  return <span className="text-xs font-semibold text-slate-400">Sin datos</span>
}

function Seccion({ titulo, icon: Icon, children }: { titulo: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="mb-10 print:mb-8 print:break-inside-avoid">
      <div className="flex items-center gap-2 mb-4 pb-2 border-b-2 border-slate-200">
        <Icon className="w-4 h-4 text-slate-600" />
        <h2 className="text-base font-bold text-slate-800">{titulo}</h2>
      </div>
      {children}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ReportePage() {
  const [dash,     setDash]     = useState<DashData | null>(null)
  const [cumpl,    setCumpl]    = useState<CumplimientoData | null>(null)
  const [riesgo,   setRiesgo]   = useState<RiesgoResumen | null>(null)
  const [cats,     setCats]     = useState<CategoriaStat[]>([])
  const [cargando, setCargando] = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const fecha = new Date().toLocaleDateString('es-SV', { year: 'numeric', month: 'long', day: 'numeric' })

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [rDash, rCumpl, rRiesgo, rCats] = await Promise.all([
        fetch('/api/proveedores/dashboard'),
        fetch('/api/proveedores/cumplimiento'),
        fetch('/api/proveedores/riesgo'),
        fetch('/api/proveedores/categorias'),
      ])

      if (!rDash.ok) throw new Error('No se pudo cargar el dashboard')

      const [dDash, dCumpl, dRiesgo, dCats] = await Promise.all([
        rDash.json(),
        rCumpl.ok  ? rCumpl.json()  : null,
        rRiesgo.ok ? rRiesgo.json() : null,
        rCats.ok   ? rCats.json()   : null,
      ])

      setDash(dDash)
      setCumpl(dCumpl)
      setRiesgo(dRiesgo?.resumen ?? null)
      setCats((dCats?.categorias ?? []).filter((c: CategoriaStat) => c.mis_productos > 0).slice(0, 8))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center gap-3 text-slate-400">
        <RefreshCw className="w-5 h-5 animate-spin" />
        <span>Preparando reporte…</span>
      </div>
    )
  }

  if (error || !dash) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-slate-500">
        <AlertTriangle className="w-10 h-10 text-amber-400" />
        <p>{error ?? 'No se pudo cargar el reporte'}</p>
        <Link href="/proveedores/dashboard" className="text-sm text-blue-600 hover:underline">← Volver al dashboard</Link>
      </div>
    )
  }

  const m = dash.metricas

  return (
    <div className="min-h-screen bg-white">

      {/* Barra de acciones (no imprime) */}
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between gap-4 shadow-sm">
        <Link href="/proveedores/dashboard" className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Volver al dashboard
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">Reporte generado: {fecha}</span>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 bg-[#1E40AF] text-white text-sm font-semibold rounded-xl hover:bg-blue-800 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Imprimir / Guardar PDF
          </button>
        </div>
      </div>

      {/* Contenido del reporte */}
      <div className="max-w-4xl mx-auto px-8 py-10 print:px-6 print:py-8">

        {/* Encabezado */}
        <div className="mb-10 pb-6 border-b-2 border-slate-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-2xl font-bold text-[#1E40AF]">Precio</span>
                <span className="text-2xl font-bold text-[#059669]">SV</span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900">{dash.proveedor.razon_social}</h1>
              <p className="text-slate-500 mt-1">Reporte Ejecutivo de Inteligencia Competitiva</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-slate-500">{fecha}</p>
              <div className="flex flex-wrap gap-1 mt-2 justify-end">
                {dash.proveedor.marcas.map(m => (
                  <span key={m} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">{m}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Métricas globales */}
        <Seccion titulo="Resumen ejecutivo" icon={BarChart2}>
          <div className="grid grid-cols-5 gap-4 mb-6">
            {[
              { label: 'Productos activos',    val: m.productos_activos },
              { label: 'Con precio registrado', val: m.productos_con_precio },
              { label: 'Ofertas vigentes',      val: m.ofertas_activas },
              { label: 'Tiendas con presencia', val: `${m.tiendas_presencia}/5` },
              { label: 'Descuento promedio',    val: m.descuento_promedio ? `${m.descuento_promedio}%` : '—' },
            ].map(({ label, val }) => (
              <div key={label} className="bg-slate-50 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-slate-800">{val}</p>
                <p className="text-xs text-slate-500 mt-1">{label}</p>
              </div>
            ))}
          </div>
        </Seccion>

        {/* Riesgo competitivo */}
        {riesgo && (
          <Seccion titulo="Score de Riesgo Competitivo" icon={ShieldCheck}>
            <div className="grid grid-cols-5 gap-3 mb-4">
              {[
                { label: 'Riesgo alto',   val: riesgo.riesgo_alto,  color: 'text-red-600',     bg: 'bg-red-50'     },
                { label: 'Riesgo medio',  val: riesgo.riesgo_medio, color: 'text-amber-600',   bg: 'bg-amber-50'   },
                { label: 'En rango',      val: riesgo.riesgo_bajo,  color: 'text-slate-600',   bg: 'bg-slate-50'   },
                { label: 'Ventaja',       val: riesgo.ventaja,      color: 'text-emerald-600', bg: 'bg-emerald-50' },
                { label: 'Sin datos',     val: riesgo.sin_datos,    color: 'text-slate-400',   bg: 'bg-slate-50'   },
              ].map(({ label, val, color, bg }) => (
                <div key={label} className={`${bg} rounded-xl p-3 text-center`}>
                  <p className={`text-2xl font-bold ${color}`}>{val}</p>
                  <p className="text-xs text-slate-500 mt-1">{label}</p>
                </div>
              ))}
            </div>
            {riesgo.alertas_dumping > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-3">
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700 font-semibold">
                  {riesgo.alertas_dumping} alerta{riesgo.alertas_dumping !== 1 ? 's' : ''} de dumping detectada{riesgo.alertas_dumping !== 1 ? 's' : ''}
                </p>
              </div>
            )}
          </Seccion>
        )}

        {/* Cumplimiento PVP */}
        {cumpl && (
          <Seccion titulo="Cumplimiento de Precio Sugerido (PVP)" icon={Tag}>
            <div className="grid grid-cols-4 gap-3 mb-5">
              {[
                { label: 'Cumpliendo PVP',     val: cumpl.resumen_global.total_ok,        color: 'text-emerald-600' },
                { label: 'Por encima del PVP', val: cumpl.resumen_global.total_alto,      color: 'text-red-600'     },
                { label: 'Por debajo del PVP', val: cumpl.resumen_global.total_bajo,      color: 'text-amber-600'   },
                { label: 'Sin datos',          val: cumpl.resumen_global.total_sin_datos, color: 'text-slate-400'   },
              ].map(({ label, val, color }) => (
                <div key={label} className="bg-slate-50 rounded-xl p-3 text-center">
                  <p className={`text-xl font-bold ${color}`}>{val}</p>
                  <p className="text-xs text-slate-500 mt-1">{label}</p>
                </div>
              ))}
            </div>

            {/* Tabla de incumplimientos (solo los problemáticos) */}
            {(() => {
              // Aplanar productos → tiendas con problemas
              type Fila = { nombre: string; marca: string | null; pvp: number | null; supermercado: string; precio: number; desviacion: number; estado: string }
              const filas: Fila[] = []
              for (const prod of cumpl.productos) {
                for (const t of prod.tiendas) {
                  if (t.estado === 'alto' || t.estado === 'bajo') {
                    filas.push({
                      nombre:      prod.nombre,
                      marca:       prod.marca,
                      pvp:         prod.pvp_sugerido,
                      supermercado: t.supermercado,
                      precio:       t.precio_efectivo,
                      desviacion:   t.desviacion_pct ?? 0,
                      estado:       t.estado,
                    })
                  }
                }
              }
              const problemas = filas.slice(0, 10)
              if (problemas.length === 0) return (
                <p className="text-sm text-emerald-600 font-medium">✓ Todos los productos cumplen el PVP sugerido.</p>
              )
              return (
                <div>
                  <p className="text-xs text-slate-500 mb-2">Productos con mayor desviación ({problemas.length} de {filas.length} incumplimientos):</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-1.5 px-2 text-slate-500 font-semibold">Producto</th>
                        <th className="text-left py-1.5 px-2 text-slate-500 font-semibold">Supermercado</th>
                        <th className="text-right py-1.5 px-2 text-slate-500 font-semibold">PVP</th>
                        <th className="text-right py-1.5 px-2 text-slate-500 font-semibold">Precio actual</th>
                        <th className="text-right py-1.5 px-2 text-slate-500 font-semibold">Desviación</th>
                        <th className="text-center py-1.5 px-2 text-slate-500 font-semibold">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {problemas.map((p, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td className="py-1.5 px-2 font-medium text-slate-700 max-w-[160px] truncate">{p.nombre}</td>
                          <td className="py-1.5 px-2 text-slate-500">{p.supermercado}</td>
                          <td className="py-1.5 px-2 text-right text-slate-600">{p.pvp != null ? `$${p.pvp.toFixed(2)}` : '—'}</td>
                          <td className="py-1.5 px-2 text-right text-slate-800 font-semibold">${p.precio.toFixed(2)}</td>
                          <td className={`py-1.5 px-2 text-right font-bold ${p.desviacion > 0 ? 'text-red-600' : 'text-amber-600'}`}>
                            {p.desviacion > 0 ? '+' : ''}{p.desviacion.toFixed(1)}%
                          </td>
                          <td className="py-1.5 px-2 text-center"><EstadoBadge estado={p.estado} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </Seccion>
        )}

        {/* Categorías */}
        {cats.length > 0 && (
          <Seccion titulo="Presencia por Categoría" icon={TrendingDown}>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-1.5 px-2 text-slate-500 font-semibold">Categoría</th>
                  <th className="text-right py-1.5 px-2 text-slate-500 font-semibold">Total productos</th>
                  <th className="text-right py-1.5 px-2 text-slate-500 font-semibold">Mis productos</th>
                  <th className="text-right py-1.5 px-2 text-slate-500 font-semibold">Share</th>
                  <th className="text-right py-1.5 px-2 text-slate-500 font-semibold">Índice vs mercado</th>
                  <th className="text-right py-1.5 px-2 text-slate-500 font-semibold">En oferta</th>
                </tr>
              </thead>
              <tbody>
                {cats.map(cat => (
                  <tr key={cat.nombre} className="border-b border-slate-100">
                    <td className="py-1.5 px-2 font-medium text-slate-700">{cat.nombre}</td>
                    <td className="py-1.5 px-2 text-right text-slate-600">{cat.total_productos}</td>
                    <td className="py-1.5 px-2 text-right text-blue-700 font-semibold">{cat.mis_productos}</td>
                    <td className="py-1.5 px-2 text-right text-slate-600">{cat.share_pct}%</td>
                    <td className={`py-1.5 px-2 text-right font-bold ${
                      cat.indice_precio === null ? 'text-slate-300' :
                      cat.indice_precio > 5 ? 'text-red-600' :
                      cat.indice_precio < -5 ? 'text-emerald-600' : 'text-slate-600'
                    }`}>
                      {cat.indice_precio !== null ? `${cat.indice_precio > 0 ? '+' : ''}${cat.indice_precio}%` : '—'}
                    </td>
                    <td className="py-1.5 px-2 text-right text-slate-600">{cat.oferta_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Seccion>
        )}

        {/* Pie del reporte */}
        <div className="mt-12 pt-6 border-t border-slate-200 text-center">
          <p className="text-xs text-slate-400">
            Generado por <strong className="text-slate-600">PrecioSV Intelligence Platform</strong> · {fecha}
          </p>
          <p className="text-xs text-slate-300 mt-1">
            Datos basados en precios scrapeados de Súper Selectos, Walmart, Don Juan, Maxi Despensa y Familiar
          </p>
        </div>

      </div>

      {/* Estilos de impresión */}
      <style jsx global>{`
        @media print {
          @page { margin: 1.5cm; size: A4; }
          body { font-size: 11px; }
          .print\\:hidden { display: none !important; }
          .print\\:break-inside-avoid { break-inside: avoid; }
          .print\\:mb-8 { margin-bottom: 2rem; }
          .print\\:px-6 { padding-left: 1.5rem; padding-right: 1.5rem; }
          .print\\:py-8 { padding-top: 2rem; padding-bottom: 2rem; }
        }
      `}</style>
    </div>
  )
}

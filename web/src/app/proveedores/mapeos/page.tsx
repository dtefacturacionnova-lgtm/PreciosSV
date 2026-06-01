'use client'

/**
 * /proveedores/mapeos — Validación de mapeos Selectos ↔ Canónico
 * El usuario aprueba o rechaza sugerencias del NLP con un click.
 * Las aprobadas se usan directamente en futuros scrapings sin NLP.
 */
import { useEffect, useState } from 'react'
import { Check, X, RefreshCw, Link2, Package, AlertCircle, CheckCircle } from 'lucide-react'

interface Mapeo {
  id:            number
  selectos_sku:  string
  confianza:     number | null
  metodo:        string
  validado:      boolean
  rechazado:     boolean
  validado_at:   string | null
  notas:         string | null
  productos: {
    id:                 number
    nombre:             string
    nombre_normalizado: string
    ean:                string | null
    imagen_url:         string | null
    marca:              string | null
  }
}

export default function MapeosPage() {
  const [mapeos,   setMapeos]   = useState<Mapeo[]>([])
  const [cargando, setCargando] = useState(true)
  const [filtro,   setFiltro]   = useState<'pendientes' | 'validados' | 'todos'>('pendientes')
  const [accion,   setAccion]   = useState<Record<number, 'ok' | 'err' | null>>({})

  async function cargar() {
    setCargando(true)
    try {
      const r = await fetch(`/api/admin/mapeos?solo=${filtro}`)
      const d = await r.json()
      setMapeos(d.mapeos ?? [])
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [filtro])

  async function accionar(id: number, tipo: 'aprobar' | 'rechazar') {
    const r = await fetch(`/api/admin/mapeos?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: tipo }),
    })
    if (r.ok) {
      setAccion(a => ({ ...a, [id]: 'ok' }))
      setTimeout(() => cargar(), 800)
    } else {
      setAccion(a => ({ ...a, [id]: 'err' }))
    }
  }

  const pendientes = mapeos.filter(m => !m.validado && !m.rechazado).length
  const validados  = mapeos.filter(m => m.validado).length

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Link2 className="w-6 h-6 text-blue-600" />
          Mapeos Selectos ↔ Productos canónicos
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Valida si dos nombres son el mismo producto. Las aprobadas se aplican
          automáticamente en futuros scrapings — sin gastar tokens de IA.
        </p>
      </div>

      {/* Stats + filtros */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {[
          { val: 'pendientes', label: `Pendientes (${pendientes})`, color: 'amber' },
          { val: 'validados',  label: `Aprobados (${validados})`,   color: 'emerald' },
          { val: 'todos',      label: 'Todos',                       color: 'slate' },
        ].map(({ val, label, color }) => (
          <button
            key={val}
            onClick={() => setFiltro(val as any)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filtro === val
                ? color === 'amber'   ? 'bg-amber-100 text-amber-700 border border-amber-300'
                : color === 'emerald' ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                :                       'bg-slate-200 text-slate-700'
                : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
        <button onClick={cargar} className="ml-auto p-2 rounded-lg hover:bg-slate-100">
          <RefreshCw className={`w-4 h-4 text-slate-400 ${cargando ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Tabla */}
      {cargando ? (
        <div className="text-center py-20 text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
          <p className="text-sm">Cargando...</p>
        </div>
      ) : mapeos.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <CheckCircle className="w-10 h-10 mx-auto mb-3 text-emerald-300" />
          <p className="font-medium text-slate-500">No hay mapeos {filtro === 'pendientes' ? 'pendientes' : ''}.</p>
          <p className="text-sm mt-1">Los nuevos aparecerán después del próximo scraping.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {mapeos.map(m => {
            const est = accion[m.id]
            return (
              <div
                key={m.id}
                className={`bg-white rounded-2xl border shadow-sm p-5 transition-all ${
                  est === 'ok'  ? 'border-emerald-200 bg-emerald-50' :
                  est === 'err' ? 'border-red-200 bg-red-50' :
                  m.validado   ? 'border-emerald-100' :
                  m.rechazado  ? 'border-slate-100 opacity-60' :
                                  'border-slate-100'
                }`}
              >
                <div className="flex flex-col sm:flex-row gap-4 items-start">

                  {/* SKU Selectos */}
                  <div className="flex-1">
                    <p className="text-xs text-slate-400 mb-1">Selectos (SKU: {m.selectos_sku})</p>
                    <p className="text-sm font-semibold text-red-700 bg-red-50 px-2 py-1 rounded-lg inline-block">
                      {m.notas?.split('↔')[0]?.replace('NLP:', '').replace(/"/g, '').trim() ?? m.selectos_sku}
                    </p>
                  </div>

                  <div className="flex-shrink-0 text-slate-300 font-bold text-lg hidden sm:block pt-5">↔</div>

                  {/* Producto canónico */}
                  <div className="flex-1">
                    <p className="text-xs text-slate-400 mb-1">
                      Producto canónico {m.productos.ean ? `(EAN: ${m.productos.ean})` : ''}
                    </p>
                    <div className="flex items-center gap-2">
                      {m.productos.imagen_url ? (
                        <img src={m.productos.imagen_url} alt="" className="w-10 h-10 object-contain rounded" />
                      ) : (
                        <Package className="w-8 h-8 text-slate-300 flex-shrink-0" />
                      )}
                      <div>
                        <p className="text-sm font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded-lg">
                          {m.productos.nombre}
                        </p>
                        {m.productos.marca && (
                          <p className="text-xs text-slate-400 mt-0.5">{m.productos.marca}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Confianza + acciones */}
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    {m.confianza != null && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        m.confianza >= 0.8 ? 'bg-emerald-100 text-emerald-700' :
                        m.confianza >= 0.6 ? 'bg-amber-100 text-amber-700' :
                                             'bg-slate-100 text-slate-600'
                      }`}>
                        {Math.round(m.confianza * 100)}% match
                      </span>
                    )}
                    <span className="text-xs text-slate-400 capitalize">{m.metodo}</span>

                    {!m.validado && !m.rechazado && (
                      <div className="flex gap-2 mt-1">
                        <button
                          onClick={() => accionar(m.id, 'rechazar')}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" /> No
                        </button>
                        <button
                          onClick={() => accionar(m.id, 'aprobar')}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" /> Sí, es el mismo
                        </button>
                      </div>
                    )}

                    {m.validado && (
                      <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                        <CheckCircle className="w-3.5 h-3.5" /> Aprobado
                      </span>
                    )}
                    {m.rechazado && (
                      <span className="flex items-center gap-1 text-xs text-slate-400">
                        <X className="w-3.5 h-3.5" /> Rechazado
                      </span>
                    )}
                  </div>
                </div>

                {/* Notas */}
                {m.notas && (
                  <p className="mt-2 text-xs text-slate-400 border-t border-slate-100 pt-2">
                    {m.notas}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

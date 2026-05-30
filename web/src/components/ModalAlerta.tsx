'use client'

/**
 * ModalAlerta — modal para crear una alerta de precio en un producto.
 * Captura email + precio objetivo y llama a POST /api/alertas.
 */
import { useState } from 'react'
import { Bell, X, Check, RefreshCw, AlertCircle } from 'lucide-react'

interface Props {
  productoId:   number
  nombreProducto: string
  precioActual: number | null
  onClose:      () => void
}

export default function ModalAlerta({ productoId, nombreProducto, precioActual, onClose }: Props) {
  const [email,         setEmail]         = useState('')
  const [precioObj,     setPrecioObj]     = useState(
    precioActual ? (precioActual * 0.9).toFixed(2) : ''  // sugerencia: 10% menos
  )
  const [guardando,     setGuardando]     = useState(false)
  const [resultado,     setResultado]     = useState<{ ok: boolean; mensaje: string } | null>(null)
  const [error,         setError]         = useState<string | null>(null)

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    if (!email.includes('@') || !email.includes('.')) {
      setError('Ingresa un email válido')
      return
    }
    const precio = parseFloat(precioObj)
    if (isNaN(precio) || precio <= 0) {
      setError('Ingresa un precio objetivo válido')
      return
    }
    if (precioActual && precio >= precioActual) {
      setError(`El precio objetivo debe ser menor al precio actual ($${precioActual.toFixed(2)})`)
      return
    }

    setGuardando(true)
    setError(null)

    try {
      const res = await fetch('/api/alertas', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          producto_id:     productoId,
          email:           email.trim(),
          precio_objetivo: precio,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Error al crear la alerta')
      } else {
        setResultado({ ok: true, mensaje: data.mensaje })
      }
    } catch {
      setError('No se pudo conectar. Intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-0">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-blue-600" />
            <h3 className="font-semibold text-slate-800">Crear alerta de precio</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="px-5 py-5">

          {/* Confirmación de éxito */}
          {resultado ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                <Check className="w-7 h-7 text-emerald-600" />
              </div>
              <p className="text-slate-800 font-medium text-sm">{resultado.mensaje}</p>
              <p className="text-slate-400 text-xs mt-1.5">
                Te enviaremos un email cuando el precio baje.
              </p>
              <button
                onClick={onClose}
                className="mt-4 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors"
              >
                Entendido
              </button>
            </div>
          ) : (
            <form onSubmit={crear} className="space-y-4">
              {/* Producto */}
              <div className="bg-slate-50 rounded-xl px-4 py-3">
                <p className="text-xs text-slate-400">Producto</p>
                <p className="text-sm font-medium text-slate-800 truncate">{nombreProducto}</p>
                {precioActual && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    Precio actual: <strong>${precioActual.toFixed(2)}</strong>
                  </p>
                )}
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Tu email
                </label>
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800
                             focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                />
              </div>

              {/* Precio objetivo */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Avisarme cuando el precio baje de
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={precioObj}
                    onChange={e => setPrecioObj(e.target.value)}
                    placeholder="0.00"
                    className="w-full border border-slate-200 rounded-xl pl-7 pr-3 py-2.5 text-sm text-slate-800
                               focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                  />
                </div>
                {precioActual && parseFloat(precioObj) > 0 && parseFloat(precioObj) < precioActual && (
                  <p className="text-xs text-emerald-600 mt-1">
                    Ahorro esperado: ${(precioActual - parseFloat(precioObj)).toFixed(2)}
                    {' '}(-{Math.round((1 - parseFloat(precioObj) / precioActual) * 100)}%)
                  </p>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 rounded-xl px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  {error}
                </div>
              )}

              {/* Botones */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 text-sm text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardando}
                  className="flex-1 px-4 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {guardando
                    ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Guardando…</>
                    : <><Bell className="w-3.5 h-3.5" /> Crear alerta</>
                  }
                </button>
              </div>

              <p className="text-[10px] text-slate-400 text-center">
                Te notificaremos por email. Puedes cancelar la alerta en cualquier momento.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

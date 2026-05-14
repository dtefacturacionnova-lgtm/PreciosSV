'use client'

/**
 * /auth/recovery
 * Página client-side que procesa los tokens de recuperación de contraseña
 * que Supabase pasa como fragmento de URL (#access_token=...&type=recovery).
 * El servidor nunca ve el fragmento, por eso necesitamos JS en el cliente.
 */
import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

export default function RecoveryPage() {
  const [estado, setEstado] = useState<'procesando' | 'ok' | 'error'>('procesando')
  const [mensaje, setMensaje] = useState('')
  const router = useRouter()

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )

    async function procesarTokens() {
      // Los tokens vienen en el hash: #access_token=...&refresh_token=...&type=recovery
      const hash = window.location.hash.substring(1)
      const params = new URLSearchParams(hash)

      const accessToken  = params.get('access_token')
      const refreshToken = params.get('refresh_token')
      const tipo         = params.get('type')

      if (!accessToken || !refreshToken) {
        setEstado('error')
        setMensaje('No se encontraron tokens de acceso en la URL.')
        return
      }

      // Establecer la sesión con los tokens del fragmento
      const { error } = await supabase.auth.setSession({
        access_token:  accessToken,
        refresh_token: refreshToken,
      })

      if (error) {
        setEstado('error')
        setMensaje(error.message)
        return
      }

      setEstado('ok')
      // Si es recovery, redirigir al dashboard (ya está autenticado)
      setTimeout(() => {
        router.replace('/proveedores/dashboard')
      }, 1200)
    }

    procesarTokens()
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-10 max-w-sm w-full text-center">
        {estado === 'procesando' && (
          <>
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-600 text-sm">Verificando sesión…</p>
          </>
        )}
        {estado === 'ok' && (
          <>
            <div className="text-4xl mb-3">✅</div>
            <p className="text-slate-800 font-semibold mb-1">¡Sesión iniciada!</p>
            <p className="text-slate-500 text-sm">Redirigiendo al dashboard…</p>
          </>
        )}
        {estado === 'error' && (
          <>
            <div className="text-4xl mb-3">❌</div>
            <p className="text-slate-800 font-semibold mb-2">Error al verificar</p>
            <p className="text-xs text-slate-500 mb-4">{mensaje}</p>
            <a
              href="/auth/login"
              className="text-sm text-blue-600 hover:underline"
            >
              Volver al login
            </a>
          </>
        )}
      </div>
    </div>
  )
}

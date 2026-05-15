'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Mail, Lock, ArrowRight, RefreshCw, CheckCircle } from 'lucide-react'
import { Suspense } from 'react'

function LoginForm() {
  const router      = useRouter()
  const params      = useSearchParams()
  const next        = params.get('next') || '/'

  const [email,     setEmail]     = useState('')
  const [password,  setPassword]  = useState('')
  const [modo,      setModo]      = useState<'password' | 'magic'>('password')
  const [cargando,  setCargando]  = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [enviado,   setEnviado]   = useState(false)

  const supabase = createClient()

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    setCargando(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Email o contraseña incorrectos.')
      setCargando(false)
    } else {
      // Reload completo para que el proxy lea la cookie de sesión recién creada.
      // router.push() es SPA-navigation y el servidor no detecta la cookie a tiempo.
      window.location.href = next
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setCargando(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    })
    setCargando(false)
    if (error) setError('No se pudo enviar el enlace. Intenta de nuevo.')
    else setEnviado(true)
  }

  if (enviado) {
    return (
      <div className="text-center">
        <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-800 mb-2">Revisa tu correo</h2>
        <p className="text-slate-500 text-sm">
          Enviamos un enlace de acceso a <strong>{email}</strong>.
          Haz clic en él para ingresar.
        </p>
        <button
          onClick={() => setEnviado(false)}
          className="mt-6 text-xs text-slate-400 hover:text-slate-600 underline"
        >
          Usar otro método
        </button>
      </div>
    )
  }

  return (
    <>
      {/* Logo */}
      <div className="text-center mb-8">
        <Link href="/" className="inline-flex items-center gap-2">
          <span className="text-2xl font-bold">
            <span className="text-[#1E40AF]">Precio</span>
            <span className="text-[#059669]">SV</span>
          </span>
        </Link>
        <p className="text-slate-500 text-sm mt-1">
          {next.startsWith('/proveedores')
            ? 'Accede al Panel de Proveedor'
            : 'Accede a tu cuenta'}
        </p>
      </div>

      {/* Selector de modo */}
      <div className="flex bg-slate-100 rounded-xl p-1 mb-6">
        <button
          onClick={() => setModo('password')}
          className={`flex-1 text-sm py-2 rounded-lg font-medium transition-all ${
            modo === 'password' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'
          }`}
        >
          Contraseña
        </button>
        <button
          onClick={() => setModo('magic')}
          className={`flex-1 text-sm py-2 rounded-lg font-medium transition-all ${
            modo === 'magic' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'
          }`}
        >
          Enlace mágico
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">
          {error}
        </div>
      )}

      <form onSubmit={modo === 'password' ? handlePassword : handleMagicLink} className="space-y-4">
        {/* Email */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
            Correo electrónico
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="tu@empresa.com"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200
                         text-sm text-slate-800 placeholder-slate-400
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Contraseña (solo en modo password) */}
        {modo === 'password' && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              Contraseña
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200
                           text-sm text-slate-800 placeholder-slate-400
                           focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={cargando}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl
                     bg-[#1E40AF] text-white text-sm font-semibold
                     hover:bg-blue-800 transition-colors disabled:opacity-60"
        >
          {cargando
            ? <RefreshCw className="w-4 h-4 animate-spin" />
            : modo === 'password' ? 'Iniciar sesión' : 'Enviar enlace de acceso'
          }
          {!cargando && <ArrowRight className="w-4 h-4" />}
        </button>
      </form>

      {modo === 'magic' && (
        <p className="text-xs text-slate-400 text-center mt-4">
          Recibirás un enlace válido por 1 hora en tu correo.
        </p>
      )}

      <div className="mt-6 pt-5 border-t border-slate-100 text-center">
        <Link href="/" className="text-xs text-slate-400 hover:text-slate-600">
          ← Volver a las ofertas
        </Link>
      </div>
    </>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
        <Suspense fallback={<div className="h-64 flex items-center justify-center"><RefreshCw className="w-5 h-5 animate-spin text-slate-300" /></div>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}

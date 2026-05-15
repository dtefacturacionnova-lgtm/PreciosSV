/**
 * Proxy (Next.js 16 — formerly middleware.ts)
 * Protege las rutas de proveedor. Redirige a /auth/login si no hay sesión.
 *
 * Rutas protegidas:
 *   /proveedores/*      — páginas del panel
 *   /api/proveedores/*  — APIs del panel (retornan 401 JSON)
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isPageRoute = pathname.startsWith('/proveedores')
  const isApiRoute  = pathname.startsWith('/api/proveedores')

  if (!isPageRoute && !isApiRoute) {
    return NextResponse.next()
  }

  // ── Crear cliente Supabase con cookies de la request ──────────────────────
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // ── Verificar sesión ───────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    if (isApiRoute) {
      return NextResponse.json(
        { error: 'No autenticado. Inicia sesión en /auth/login' },
        { status: 401 }
      )
    }
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/proveedores/:path*',
    '/api/proveedores/:path*',
  ],
}

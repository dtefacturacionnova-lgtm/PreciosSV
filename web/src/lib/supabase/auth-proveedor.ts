/**
 * Helper: obtiene el proveedor asociado al usuario autenticado.
 * Usar en todas las rutas /api/proveedores/* para reemplazar el patrón
 * de hardcode `.limit(1).single()`.
 *
 * Retorna null si:
 *   - No hay sesión activa (el middleware debería haber bloqueado la request)
 *   - El usuario no tiene un proveedor vinculado (user_id no matchea)
 */
import { createClient } from './server'
import { createServiceClient } from './service'

interface ProveedorBasico {
  id:           number
  razon_social: string
  user_id:      string
  marcas:       string[]
  competidores: string[]
}

export async function getProveedorAutenticado(): Promise<ProveedorBasico | null> {
  try {
    // 1. Obtener usuario de la sesión (cookie-based, server-side)
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return null

    // 2. Buscar el proveedor vinculado a ese user_id usando service client
    //    (el service client bypasa RLS, pero ya validamos el user_id arriba)
    const db = createServiceClient()
    const { data, error } = await db
      .from('proveedores')
      .select('id, razon_social, user_id, marcas, competidores')
      .eq('user_id', user.id)
      .eq('activo', true)
      .single()

    if (error || !data) return null
    return data as unknown as ProveedorBasico
  } catch {
    return null
  }
}

/**
 * Versión para desarrollo: si el usuario no tiene proveedor vinculado,
 * cae al primer proveedor activo (permite probar sin configurar auth).
 * SOLO usar en entornos de desarrollo (NODE_ENV !== 'production').
 */
export async function getProveedorAutenticadoODev(): Promise<ProveedorBasico | null> {
  const prov = await getProveedorAutenticado()
  if (prov) return prov

  // Fallback de desarrollo
  if (process.env.NODE_ENV === 'production') return null

  const db = createServiceClient()
  const { data } = await db
    .from('proveedores')
    .select('id, razon_social, user_id, marcas, competidores')
    .eq('activo', true)
    .limit(1)
    .single()

  return (data as unknown as ProveedorBasico) ?? null
}

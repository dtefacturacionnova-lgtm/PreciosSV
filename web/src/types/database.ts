export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type SupermercadoKey = 'selectos' | 'walmart' | 'donjuan' | 'maxidespensa' | 'familiar' | 'pricesmart'
export type UserRole = 'admin' | 'proveedor' | 'usuario'
export type AlertaTipo = 'oferta_competencia' | 'precio_minimo' | 'posicion_perdida' | 'sin_stock_competidor'

export interface Database {
  public: {
    Tables: {
      supermercados: {
        Row: {
          id: number
          nombre: string
          nombre_corto: SupermercadoKey
          logo_url: string | null
          color_hex: string
          sitio_web: string | null
          activo: boolean
          created_at: string
        }
      }
      categorias: {
        Row: {
          id: number
          nombre: string
          slug: string
          icono: string | null
          parent_id: number | null
          activa: boolean
        }
      }
      productos: {
        Row: {
          id: number
          nombre_normalizado: string
          marca: string | null
          categoria_id: number | null
          descripcion: string | null
          imagen_url: string | null
          ean: string | null
          unidad: string | null
          cantidad: number | null
          activo: boolean
          created_at: string
        }
      }
      producto_variantes: {
        Row: {
          id: number
          producto_id: number
          supermercado_id: number
          nombre_local: string | null
          sku_local: string
          url_producto: string | null
          activo: boolean
        }
      }
      precios: {
        Row: {
          id: number
          variante_id: number
          precio_normal: number
          precio_oferta: number | null
          en_oferta: boolean
          descuento_pct: number | null
          disponible: boolean
          condicion_oferta: string | null
          fecha_hora: string
        }
      }
      usuarios: {
        Row: {
          id: number
          auth_id: string
          nombre: string
          email: string
          rol: UserRole
          activo: boolean
          created_at: string
        }
      }
      alertas_usuario: {
        Row: {
          id: number
          usuario_id: number
          producto_id: number
          precio_objetivo: number
          supermercado_id: number | null
          activa: boolean
          ultima_notificacion: string | null
          created_at: string
        }
      }
    }
    Views: {
      precios_actuales: {
        Row: {
          variante_id: number
          producto_id: number
          supermercado_id: number
          precio_normal: number
          precio_oferta: number | null
          en_oferta: boolean
          descuento_pct: number | null
          disponible: boolean
          condicion_oferta: string | null
          fecha_hora: string
        }
      }
    }
  }
}

// Tipos derivados para uso en componentes
export type Supermercado = Database['public']['Tables']['supermercados']['Row']
export type Categoria = Database['public']['Tables']['categorias']['Row']
export type Producto = Database['public']['Tables']['productos']['Row']
export type Precio = Database['public']['Tables']['precios']['Row']
export type PrecioActual = Database['public']['Views']['precios_actuales']['Row']

export interface OfertaDelDia {
  producto_id: number
  nombre_normalizado: string
  marca: string | null
  imagen_url: string | null
  precio_normal: number
  precio_oferta: number
  descuento_pct: number
  condicion_oferta: string | null
  supermercado_id: number
  supermercado_nombre: string
  supermercado_key: SupermercadoKey
  supermercado_color: string
  categoria_nombre: string | null
  url_producto: string | null
}

export interface ComparativaProducto {
  id: number
  nombre_normalizado: string
  marca: string | null
  imagen_url: string | null
  ean: string | null
  unidad: string | null
  cantidad: number | null
  categoria: Categoria | null
  precios: Array<{
    supermercado: Supermercado
    precio_normal: number
    precio_oferta: number | null
    en_oferta: boolean
    descuento_pct: number | null
    disponible: boolean
    condicion_oferta: string | null
    fecha_hora: string
  }>
}

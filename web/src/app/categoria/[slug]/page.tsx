/**
 * /categoria/[slug] — Landing de categoría con ISR (1h)
 * Server component para SEO. Muestra mejores ofertas + productos más baratos.
 */
import { Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import type { Metadata } from 'next'
import CategoriaProductos from '@/components/CategoriaProductos'

export const revalidate = 3600 // ISR: revalida cada hora

// ─── Metadata dinámica para SEO ──────────────────────────────────────────────

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const supabase  = await createClient()
  const { data: catRaw } = await supabase
    .from('categorias')
    .select('nombre, emoji')
    .eq('slug', slug)
    .maybeSingle()

  const cat = catRaw as { nombre: string; emoji: string | null } | null

  if (!cat) return { title: 'Categoría no encontrada | PrecioSV' }

  const nombre = cat.nombre
  const emoji  = cat.emoji ?? ''

  return {
    title: `${emoji} ${nombre} — Mejores precios en El Salvador | PrecioSV`,
    description: `Compara precios de ${nombre} en Súper Selectos, Walmart, Don Juan, Maxi Despensa y Familiar. Encuentra las mejores ofertas del día.`,
    keywords:    ['precios', nombre, 'supermercados', 'El Salvador', 'ofertas'],
  }
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default async function CategoriaPage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const supabase  = await createClient()

  const { data: catRaw2 } = await supabase
    .from('categorias')
    .select('id, nombre, emoji')
    .eq('slug', slug)
    .maybeSingle()

  const cat2 = catRaw2 as { id: number; nombre: string; emoji: string | null } | null
  if (!cat2) notFound()

  const nombre = cat2!.nombre
  const emoji  = cat2!.emoji ?? '🛒'

  return (
    <main className="max-w-7xl mx-auto px-4 py-6">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-slate-400 mb-5">
        <Link href="/" className="hover:text-slate-600 flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Inicio
        </Link>
        <span>/</span>
        <span className="text-slate-600">{nombre}</span>
      </nav>

      {/* Header */}
      <div className="mb-7">
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
          <span className="text-4xl">{emoji}</span>
          {nombre}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Mejores precios en supermercados de El Salvador
        </p>
      </div>

      {/* Productos */}
      <Suspense fallback={
        <div className="flex flex-col items-center gap-3 py-20 text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <p className="text-sm">Cargando productos…</p>
        </div>
      }>
        <CategoriaProductos slug={slug} categoriaId={cat2!.id} />
      </Suspense>

    </main>
  )
}

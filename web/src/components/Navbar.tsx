'use client'

import { Search, User, ChevronRight, ShoppingCart } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCanasta } from '@/lib/canasta'

export default function Navbar() {
  const [query, setQuery] = useState('')
  const router = useRouter()
  const { totalItems } = useCanasta()

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (query.trim()) router.push(`/buscar?q=${encodeURIComponent(query.trim())}`)
  }

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-4">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 flex-shrink-0">
          <div className="w-8 h-8 flex items-center justify-center">
            <svg viewBox="0 0 32 32" fill="none" className="w-8 h-8">
              <rect x="2" y="8" width="20" height="16" rx="3" fill="#1E40AF"/>
              <circle cx="8" cy="12" r="2" fill="white"/>
              <line x1="12" y1="12" x2="19" y2="12" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              <line x1="12" y1="16" x2="19" y2="16" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              <line x1="12" y1="20" x2="16" y2="20" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              <path d="M20 4 L28 12 L20 20" stroke="#059669" strokeWidth="2.5" fill="none" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-xl font-bold tracking-tight">
            <span className="text-[#1E40AF]">Precio</span>
            <span className="text-[#059669]">SV</span>
          </span>
        </Link>

        {/* Buscador */}
        <form onSubmit={handleSearch} className="flex-1 max-w-2xl">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar productos, marcas, supermercados..."
              className="w-full pl-10 pr-4 py-2.5 rounded-full border border-slate-200 bg-slate-50
                         text-sm text-slate-800 placeholder-slate-400
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                         transition-all"
            />
          </div>
        </form>

        {/* Acciones */}
        <div className="flex items-center gap-2 flex-shrink-0">

          {/* Canasta */}
          <Link
            href="/canasta"
            className="relative p-2 rounded-full text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
            title="Mi canasta"
          >
            <ShoppingCart className="w-5 h-5" />
            {totalItems > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                {totalItems > 9 ? '9+' : totalItems}
              </span>
            )}
          </Link>

          <Link
            href="/auth/login"
            className="hidden sm:flex items-center gap-1.5 px-4 py-2 rounded-full border border-slate-300
                       text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <User className="w-4 h-4" />
            Iniciar sesión
          </Link>
          <Link
            href="/proveedores/dashboard"
            className="flex items-center gap-1 px-4 py-2 rounded-full bg-[#059669] text-white
                       text-sm font-medium hover:bg-emerald-700 transition-colors"
          >
            Soy Proveedor
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

      </div>
    </header>
  )
}

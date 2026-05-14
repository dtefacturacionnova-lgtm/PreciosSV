'use client'

import Link from 'next/link'
import { BarChart2, Bell, TrendingDown, ArrowRight } from 'lucide-react'

const beneficios = [
  { icono: BarChart2, texto: 'Monitorea tu posición vs. la competencia en tiempo real' },
  { icono: Bell,      texto: 'Alertas automáticas cuando un competidor lanza una oferta' },
  { icono: TrendingDown, texto: 'Analiza tendencias de precios por categoría y cadena' },
]

export default function SeccionB2B() {
  return (
    <section className="bg-[#0F172A] py-16 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row items-center gap-10 lg:gap-20">

          {/* Texto */}
          <div className="flex-1 text-center lg:text-left">
            <div className="inline-block mb-3">
              <span className="text-[#059669] text-sm font-semibold tracking-widest uppercase">
                Para Proveedores y Fabricantes
              </span>
            </div>
            <h2 className="text-3xl lg:text-4xl font-bold text-white mb-4 leading-tight">
              ¿Eres proveedor<br />o fabricante?
            </h2>
            <p className="text-slate-400 text-lg mb-8 max-w-lg">
              Lleva tus productos a miles de compradores. Publica precios,
              gestiona ofertas y analiza tendencias del mercado salvadoreño.
            </p>
            <Link
              href="/proveedores/registro"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full
                         bg-[#059669] text-white font-semibold hover:bg-emerald-500
                         transition-colors text-base shadow-lg shadow-emerald-900/30"
            >
              Comenzar gratis
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {/* Beneficios */}
          <div className="flex-1 w-full max-w-md">
            <div className="flex flex-col gap-4">
              {beneficios.map(({ icono: Icono, texto }) => (
                <div
                  key={texto}
                  className="flex items-start gap-4 bg-white/5 border border-white/10
                             rounded-xl p-4 hover:bg-white/8 transition-colors"
                >
                  <div className="w-10 h-10 rounded-lg bg-[#059669]/20 flex items-center justify-center flex-shrink-0">
                    <Icono className="w-5 h-5 text-[#059669]" />
                  </div>
                  <p className="text-slate-300 text-sm leading-relaxed">{texto}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}

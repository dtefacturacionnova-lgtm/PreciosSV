import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Navbar from '@/components/Navbar'
import { CanastaProvider } from '@/lib/canasta'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'PrecioSV — Compara precios en supermercados de El Salvador',
  description: 'Encuentra el mejor precio de tus productos favoritos en Súper Selectos, Walmart, Don Juan, Maxi Despensa y Familiar.',
  keywords: ['precios', 'supermercados', 'El Salvador', 'ofertas', 'comparar precios'],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <CanastaProvider>
          <Navbar />
          <div className="flex-1">{children}</div>
          <footer className="border-t border-slate-200 bg-white py-6 px-4 text-center text-sm text-slate-400">
            © {new Date().getFullYear()} PrecioSV · Datos actualizados cada 6 horas
          </footer>
        </CanastaProvider>
      </body>
    </html>
  )
}

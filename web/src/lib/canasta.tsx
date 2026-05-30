'use client'

/**
 * CanastaContext — estado de la canasta inteligente
 * Persiste en localStorage bajo la clave 'preciosv_canasta'
 */
import {
  createContext, useContext, useEffect, useState, useCallback,
} from 'react'

export interface ItemCanasta {
  id:         number
  nombre:     string
  imagen_url: string | null
  cantidad:   number
}

interface CanastaContextType {
  items:        ItemCanasta[]
  totalItems:   number
  agregar:      (item: Omit<ItemCanasta, 'cantidad'>) => void
  actualizar:   (id: number, cantidad: number) => void
  eliminar:     (id: number) => void
  limpiar:      () => void
  estaEnCanasta:(id: number) => boolean
}

const CanastaContext = createContext<CanastaContextType | null>(null)

const LS_KEY = 'preciosv_canasta'

export function CanastaProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ItemCanasta[]>([])
  const [hydrated, setHydrated] = useState(false)

  // Cargar desde localStorage solo en cliente
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY)
      if (saved) setItems(JSON.parse(saved))
    } catch {}
    setHydrated(true)
  }, [])

  // Guardar en localStorage cuando cambia
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(items))
    } catch {}
  }, [items, hydrated])

  const agregar = useCallback((item: Omit<ItemCanasta, 'cantidad'>) => {
    setItems(prev => {
      const existe = prev.find(i => i.id === item.id)
      if (existe) {
        return prev.map(i => i.id === item.id ? { ...i, cantidad: i.cantidad + 1 } : i)
      }
      return [...prev, { ...item, cantidad: 1 }]
    })
  }, [])

  const actualizar = useCallback((id: number, cantidad: number) => {
    if (cantidad <= 0) {
      setItems(prev => prev.filter(i => i.id !== id))
    } else {
      setItems(prev => prev.map(i => i.id === id ? { ...i, cantidad } : i))
    }
  }, [])

  const eliminar = useCallback((id: number) => {
    setItems(prev => prev.filter(i => i.id !== id))
  }, [])

  const limpiar = useCallback(() => setItems([]), [])

  const estaEnCanasta = useCallback((id: number) => items.some(i => i.id === id), [items])

  const totalItems = items.reduce((s, i) => s + i.cantidad, 0)

  return (
    <CanastaContext.Provider value={{
      items, totalItems, agregar, actualizar, eliminar, limpiar, estaEnCanasta,
    }}>
      {children}
    </CanastaContext.Provider>
  )
}

export function useCanasta() {
  const ctx = useContext(CanastaContext)
  if (!ctx) throw new Error('useCanasta debe usarse dentro de CanastaProvider')
  return ctx
}

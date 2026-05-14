import type { SupermercadoKey } from '@/types/database'

export const SUPERMERCADOS: Record<SupermercadoKey, { nombre: string; color: string; bgClass: string }> = {
  selectos:     { nombre: 'Súper Selectos',       color: '#DC2626', bgClass: 'bg-red-600' },
  walmart:      { nombre: 'Walmart',              color: '#1D4ED8', bgClass: 'bg-blue-700' },
  donjuan:      { nombre: 'Don Juan',             color: '#16A34A', bgClass: 'bg-green-600' },
  maxidespensa: { nombre: 'Maxi Despensa',        color: '#EA580C', bgClass: 'bg-orange-600' },
  familiar:     { nombre: 'Familiar',             color: '#7C3AED', bgClass: 'bg-violet-600' },
  pricesmart:   { nombre: 'PriceSmart',           color: '#0051A5', bgClass: 'bg-blue-800' },
}

export const FILTROS_SUPERMERCADO = [
  { key: 'todos',        label: 'Todos' },
  { key: 'selectos',     label: 'Súper Selectos' },
  { key: 'walmart',      label: 'Walmart' },
  { key: 'donjuan',      label: 'Don Juan' },
  { key: 'maxidespensa', label: 'Maxi Despensa' },
  { key: 'familiar',     label: 'Familiar' },
  { key: 'pricesmart',   label: 'PriceSmart' },
] as const

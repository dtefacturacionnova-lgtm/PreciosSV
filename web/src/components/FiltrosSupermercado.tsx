'use client'

import { FILTROS_SUPERMERCADO, SUPERMERCADOS } from '@/lib/constants'
import type { SupermercadoKey } from '@/types/database'
import clsx from 'clsx'

interface Props {
  activo: string
  onChange: (key: string) => void
}

export default function FiltrosSupermercado({ activo, onChange }: Props) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {FILTROS_SUPERMERCADO.map(({ key, label }) => {
        const isActive = activo === key
        const color = key !== 'todos'
          ? SUPERMERCADOS[key as SupermercadoKey]?.color
          : undefined

        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap',
              'border transition-all duration-150',
              isActive
                ? 'text-white border-transparent shadow-sm'
                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
            )}
            style={isActive ? { backgroundColor: key === 'todos' ? '#1E40AF' : color } : undefined}
          >
            {key !== 'todos' && (
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: isActive ? 'white' : color }}
              />
            )}
            {label}
          </button>
        )
      })}
    </div>
  )
}

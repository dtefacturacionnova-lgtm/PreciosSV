import { type LucideIcon } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  icono: LucideIcon
  label: string
  valor: string | number
  sub?: string
  color?: 'blue' | 'emerald' | 'amber' | 'slate'
}

const COLOR = {
  blue:    { bg: 'bg-blue-50',    icon: 'text-blue-600',    val: 'text-blue-700' },
  emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600', val: 'text-emerald-700' },
  amber:   { bg: 'bg-amber-50',   icon: 'text-amber-600',   val: 'text-amber-700' },
  slate:   { bg: 'bg-slate-50',   icon: 'text-slate-500',   val: 'text-slate-700' },
}

export default function MetricaCard({ icono: Icono, label, valor, sub, color = 'slate' }: Props) {
  const c = COLOR[color]
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex items-start gap-4">
      <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', c.bg)}>
        <Icono className={clsx('w-5 h-5', c.icon)} />
      </div>
      <div>
        <p className="text-xs font-medium text-slate-500 mb-0.5">{label}</p>
        <p className={clsx('text-2xl font-bold', c.val)}>{valor}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

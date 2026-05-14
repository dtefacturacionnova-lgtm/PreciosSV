'use client'

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { useMemo } from 'react'

interface PuntoHistorico {
  fecha: string
  precio_efectivo: number
  supermercado_nombre: string
  supermercado_key: string
  supermercado_color: string
}

interface Props {
  historico: PuntoHistorico[]
  dias: number
}

// Tooltip personalizado
function TooltipCustom({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-sm">
      <p className="font-semibold text-slate-600 mb-2">
        {new Date(label).toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}
      </p>
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-slate-600">{entry.name}:</span>
          <span className="font-bold text-slate-900">${entry.value?.toFixed(2)}</span>
        </div>
      ))}
    </div>
  )
}

export default function HistoricoChart({ historico, dias }: Props) {
  // Agrupar datos por fecha y supermercado para recharts
  const { chartData, supermercados } = useMemo(() => {
    if (!historico.length) return { chartData: [], supermercados: [] }

    // Extraer supermercados únicos
    const superMap = new Map<string, { nombre: string; color: string }>()
    historico.forEach(p => {
      if (!superMap.has(p.supermercado_key)) {
        superMap.set(p.supermercado_key, {
          nombre: p.supermercado_nombre,
          color: p.supermercado_color,
        })
      }
    })

    // Agrupar por fecha
    const fechaMap = new Map<string, Record<string, number>>()
    historico.forEach(p => {
      const dia = p.fecha.split('T')[0]
      if (!fechaMap.has(dia)) fechaMap.set(dia, { fecha: dia } as any)
      fechaMap.get(dia)![p.supermercado_key] = p.precio_efectivo
    })

    const chartData = Array.from(fechaMap.values()).sort((a, b) =>
      (a.fecha as unknown as string).localeCompare(b.fecha as unknown as string)
    )

    const supermercados = Array.from(superMap.entries()).map(([key, val]) => ({
      key, ...val,
    }))

    return { chartData, supermercados }
  }, [historico])

  if (!chartData.length) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center">
        <p className="text-slate-400 text-sm">
          Historial disponible próximamente — se acumula con cada scrape
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700">
          Evolución de precios — últimos {dias} días
        </h3>
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="fecha"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            tickFormatter={v => new Date(v).toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            tickFormatter={v => `$${v.toFixed(2)}`}
            tickLine={false}
            axisLine={false}
            width={52}
          />
          <Tooltip content={<TooltipCustom />} />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }}
          />
          {supermercados.map(super_ => (
            <Line
              key={super_.key}
              type="monotone"
              dataKey={super_.key}
              name={super_.nombre}
              stroke={super_.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

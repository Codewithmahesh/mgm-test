'use client'

import { useEffect, useState } from 'react'
import { BarChart3, Table2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type BarDatum = { label: string; value: number; detail?: string; href?: string }

/**
 * Single-series column chart of percentages (0–100). One colour (no legend: the card title
 * names the series), thin columns with rounded tops, hairline grid, a tooltip per column,
 * only the highest value labelled, and a table view for exact numbers.
 */
export function BarChart({ data, height = 220, valueSuffix = '%', empty = 'No data yet.' }: { data: BarDatum[]; height?: number; valueSuffix?: string; empty?: string }) {
  const [grown, setGrown] = useState(false)
  const [asTable, setAsTable] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => { const id = requestAnimationFrame(() => setGrown(true)); return () => cancelAnimationFrame(id) }, [])

  if (!data.length) return <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>{empty}</div>
  const maxIndex = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0)
  const ticks = [100, 75, 50, 25, 0]

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button onClick={() => setAsTable(v => !v)} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground" aria-pressed={asTable}>
          {asTable ? <><BarChart3 className="size-3.5" />Chart</> : <><Table2 className="size-3.5" />Table</>}
        </button>
      </div>
      {asTable ? (
        <div className="overflow-auto rounded-md border border-border" style={{ maxHeight: height + 40 }}>
          <table className="table-base">
            <thead><tr><th>Exam</th><th className="text-right">Average</th><th>Details</th></tr></thead>
            <tbody>{data.map(d => <tr key={d.label}><td className="font-medium">{d.label}</td><td className="text-right tabular-nums">{d.value}{valueSuffix}</td><td className="text-muted-foreground">{d.detail}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-3">
          <div className="relative flex flex-col justify-between pb-6 text-right text-[11px] tabular-nums text-subtle" style={{ height }} aria-hidden>
            {ticks.map(t => <span key={t} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">{t}{valueSuffix}</span>)}
          </div>
          <div className="relative min-w-0 flex-1" style={{ height }}>
            <div className="absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between" aria-hidden>
              {ticks.map(t => <span key={t} className="h-px w-full bg-border" />)}
            </div>
            <div className="absolute inset-x-0 top-0 bottom-6 flex items-end" role="list" aria-label="Average score by exam">
              {data.map((d, i) => (
                <div key={`${d.label}-${i}`} role="listitem" aria-label={`${d.label}: ${d.value}${valueSuffix}`} className="relative flex h-full flex-1 cursor-default items-end justify-center" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
                  <div
                    className={cn('w-full max-w-6 rounded-t-[4px] bg-chart transition-[height,background-color] duration-700 ease-out', hover !== null && hover !== i && 'bg-chart/35')}
                    style={{ height: grown ? `${Math.max(1, Math.min(100, d.value))}%` : '0%', transitionDelay: grown ? `${i * 45}ms` : '0ms' }}
                  />
                  {i === maxIndex && hover === null && <span className="absolute text-[11px] font-semibold tabular-nums text-foreground" style={{ bottom: `calc(${Math.min(100, d.value)}% + 4px)` }}>{d.value}{valueSuffix}</span>}
                  {hover === i && (
                    <div className="pointer-events-none absolute z-10 w-max max-w-52 -translate-y-2 rounded-md bg-navy px-2.5 py-1.5 text-xs text-white shadow-lg" style={{ bottom: `${Math.min(100, d.value)}%` }}>
                      <p className="font-semibold">{d.label}</p>
                      <p className="tabular-nums text-white/80">{d.value}{valueSuffix}{d.detail ? ` · ${d.detail}` : ''}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="absolute inset-x-0 bottom-0 flex h-5" aria-hidden>
              {data.map((d, i) => <span key={`${d.label}-x-${i}`} className="flex-1 truncate px-0.5 text-center text-[11px] text-muted-foreground" title={d.label}>{d.label}</span>)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { AlertTriangle } from 'lucide-react'
import { Input } from '@/components/ui/form'
import { useFeedback } from '@/components/ui/overlay'
import { BLOOM_INFO, BLOOM_LEVELS, type BloomLevel, type BloomPlan } from '@/lib/bloom'
import { cn } from '@/lib/utils'

/** Form state for a Bloom plan: count and marks per level, as typed. */
export type PlanDraft = Record<BloomLevel, { count: string; marks: string }>

export function emptyPlanDraft(marks = 1): PlanDraft {
  return Object.fromEntries(BLOOM_LEVELS.map(level => [level, { count: '0', marks: String(marks) }])) as PlanDraft
}

export function planToDraft(plan: BloomPlan, defaultMarks = 1): PlanDraft {
  const draft = emptyPlanDraft(defaultMarks)
  for (const row of plan) draft[row.level] = { count: String(row.count), marks: String(row.marks) }
  return draft
}

export function draftToPlan(draft: PlanDraft): BloomPlan {
  return BLOOM_LEVELS.map(level => ({ level, count: toInt(draft[level].count), marks: toNumber(draft[level].marks) })).filter(row => row.count > 0)
}

export const draftCount = (draft: PlanDraft) => BLOOM_LEVELS.reduce((sum, level) => sum + toInt(draft[level].count), 0)

const toInt = (value: string) => Math.max(0, Math.round(Number(value) || 0))
const toNumber = (value: string) => Math.max(0, Number(value) || 0)
const fmt = (value: number) => String(Math.round(value * 100) / 100)

/**
 * Number of questions (and optionally marks per question) for each of Bloom's six levels.
 * The levels can't add up to more than `total`: going over asks whether to raise the question count.
 */
export function BloomPlanEditor({ total, onTotalChange, draft, onChange, showMarks = true, defaultMarks = 1, unit = 'paper' }: {
  total: number
  onTotalChange: (total: number) => void
  draft: PlanDraft
  onChange: (draft: PlanDraft) => void
  showMarks?: boolean
  defaultMarks?: number
  unit?: 'paper' | 'set'
}) {
  const { confirm } = useFeedback()
  const assigned = draftCount(draft)
  const over = assigned > total
  const rest = Math.max(0, total - assigned)
  const plannedMarks = BLOOM_LEVELS.reduce((sum, level) => sum + toInt(draft[level].count) * toNumber(draft[level].marks), 0)

  async function setCount(level: BloomLevel, value: string) {
    const next = { ...draft, [level]: { ...draft[level], count: value } }
    const sum = draftCount(next)
    if (sum <= total) return onChange(next)
    const others = sum - toInt(value)
    onChange(next)
    const raise = await confirm({
      title: 'Question limit exceeded',
      description: <>The Bloom levels now add up to <b>{sum}</b> questions, but each {unit} has only <b>{total}</b>. Increase the question count to {sum}, or keep {total} and lower this level.</>,
      confirmLabel: `Increase to ${sum}`,
      cancelLabel: `Keep ${total}`,
    })
    if (raise) onTotalChange(sum)
    else onChange({ ...draft, [level]: { ...draft[level], count: String(Math.max(0, total - others)) } })
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className={cn('grid items-center gap-3 border-b border-border bg-muted/60 px-3.5 py-2 text-xs font-medium text-muted-foreground', showMarks ? 'grid-cols-[minmax(0,1fr)_84px_84px_64px]' : 'grid-cols-[minmax(0,1fr)_84px]')}>
        <span>Bloom&apos;s level</span><span>Questions</span>{showMarks && <><span>Marks each</span><span className="text-right">Marks</span></>}
      </div>
      {BLOOM_LEVELS.map(level => {
        const info = BLOOM_INFO[level]
        const count = toInt(draft[level].count)
        return (
          <div key={level} className={cn('grid items-center gap-3 border-b border-border px-3.5 py-2 last:border-0', showMarks ? 'grid-cols-[minmax(0,1fr)_84px_84px_64px]' : 'grid-cols-[minmax(0,1fr)_84px]', count > 0 && 'bg-primary-soft/30')}>
            <div className="min-w-0">
              <p className="text-[13px] font-medium"><span className="mr-1.5 font-mono text-xs text-muted-foreground">L{info.n}</span>{info.label}</p>
              <p className="truncate text-[11px] text-muted-foreground">{info.hint}</p>
            </div>
            <Input type="number" min={0} max={500} aria-label={`${info.label} questions`} value={draft[level].count} onChange={e => setCount(level, e.target.value)} className="h-8" />
            {showMarks && <>
              <Input type="number" min={0} max={100} step={0.25} aria-label={`${info.label} marks per question`} value={draft[level].marks} disabled={count === 0}
                onChange={e => onChange({ ...draft, [level]: { ...draft[level], marks: e.target.value } })} className="h-8" />
              <span className="text-right text-[13px] tabular-nums text-muted-foreground">{count ? fmt(count * toNumber(draft[level].marks)) : '–'}</span>
            </>}
          </div>
        )
      })}
      <div className={cn('flex flex-wrap items-center justify-between gap-2 border-t px-3.5 py-2.5 text-[13px]', over ? 'border-danger-border bg-danger-soft text-danger-ink' : 'border-border bg-muted/40')}>
        {over ? (
          <span className="flex items-center gap-1.5 font-medium"><AlertTriangle className="size-4" />Levels add up to {assigned}, more than the {total} questions per {unit}.</span>
        ) : (
          <span><b className="font-semibold tabular-nums">{assigned}</b> of {total} questions assigned{rest > 0 && <span className="text-muted-foreground"> · {rest} more will be picked across all levels{showMarks && ` at ${fmt(defaultMarks)} mark${defaultMarks === 1 ? '' : 's'} each`}</span>}</span>
        )}
        {over ? (
          <button type="button" onClick={() => onTotalChange(assigned)} className="rounded-md bg-card px-2.5 py-1 text-xs font-medium text-foreground ring-1 ring-border hover:bg-muted">Increase to {assigned}</button>
        ) : showMarks && <span className="font-medium tabular-nums">{fmt(plannedMarks + rest * defaultMarks)} marks per {unit}</span>}
      </div>
    </div>
  )
}

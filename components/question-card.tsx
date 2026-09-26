'use client'

import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { DifficultyBadge, TypeBadge } from '@/components/common'
import { letter, type DraftQuestion } from '@/lib/api'
import { cn } from '@/lib/utils'

/** Compact, expandable preview of a question (MCQ options with the answer, or a coding problem's details). */
export function QuestionCard({ question, index, actions, meta, defaultOpen = false, selectable }: {
  question: DraftQuestion
  index?: number
  actions?: React.ReactNode
  meta?: React.ReactNode
  defaultOpen?: boolean
  selectable?: { checked: boolean; onChange: () => void }
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={cn('group border-b border-border px-4 py-3 last:border-0', selectable?.checked && 'bg-primary-soft/40')}>
      <div className="flex items-start gap-3">
        {selectable && <input type="checkbox" checked={selectable.checked} onChange={selectable.onChange} className="mt-1 size-4 accent-[var(--primary)]" aria-label="Select question" />}
        {index !== undefined && <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-xs text-subtle">{index + 1}.</span>}
        <button type="button" onClick={() => setOpen(value => !value)} className="min-w-0 flex-1 text-left">
          <p className={cn('text-sm leading-6 text-foreground', !open && 'line-clamp-2')}>
            {question.type === 'coding' ? <span className="font-semibold">{question.title || 'Untitled problem'}</span> : question.text}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <TypeBadge type={question.type} />
            <DifficultyBadge difficulty={question.difficulty} />
            {question.set && <span className="rounded border border-border px-1.5 py-px text-[11px] font-semibold text-muted-foreground">Set {question.set}</span>}
            {question.topic && <span className="text-xs text-muted-foreground">{question.topic}</span>}
            {question.type === 'coding' && question.points != null && <span className="text-xs text-muted-foreground">· {question.points} marks</span>}
            {meta}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {actions}
          <button type="button" onClick={() => setOpen(value => !value)} aria-label={open ? 'Collapse' : 'Expand'} className="rounded p-1.5 text-subtle hover:bg-muted hover:text-foreground"><ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} /></button>
        </div>
      </div>
      {open && (
        <div className={cn('mt-3', index !== undefined && 'pl-9', selectable && 'pl-7')}>
          {question.type === 'coding' ? (
            <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3 text-[13px]">
              <p className="whitespace-pre-wrap leading-6">{question.text}</p>
              {question.inputFormat && <Section label="Input">{question.inputFormat}</Section>}
              {question.outputFormat && <Section label="Output">{question.outputFormat}</Section>}
              {question.constraints && <Section label="Constraints"><span className="font-mono">{question.constraints}</span></Section>}
              {question.samples.map((sample, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-2">
                  <pre className="overflow-x-auto rounded bg-card p-2 font-mono text-xs ring-1 ring-border"><span className="mb-1 block font-sans text-[10px] font-semibold uppercase text-subtle">Sample input {i + 1}</span>{sample.input}</pre>
                  <pre className="overflow-x-auto rounded bg-card p-2 font-mono text-xs ring-1 ring-border"><span className="mb-1 block font-sans text-[10px] font-semibold uppercase text-subtle">Sample output {i + 1}</span>{sample.output}</pre>
                </div>
              ))}
            </div>
          ) : (
            <>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {question.options.map((option, i) => (
                  <li key={i} className={cn('flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-[13px]', i === question.correctIndex ? 'border-success-border bg-success-soft font-medium text-success-ink' : 'border-border text-muted-foreground')}>
                    <span className="font-mono text-xs font-semibold">{letter(i)}</span><span className="flex-1">{option}</span>{i === question.correctIndex && <Check className="mt-0.5 size-3.5" />}
                  </li>
                ))}
              </ul>
              {question.explanation && <p className="mt-2 text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">Explanation:</span> {question.explanation}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{label}</p><p className="mt-0.5 whitespace-pre-wrap leading-6">{children}</p></div>
}

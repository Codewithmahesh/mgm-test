'use client'

import Link from 'next/link'
import { use, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Code2, Minus, PlayCircle, Save, X } from 'lucide-react'
import { EVENT_ICONS, FlagChips, RiskBadge } from '@/components/integrity'
import { INTEGRITY_EVENTS, type Flags, type IntegrityEvent, type RiskLevel } from '@/lib/integrity'
import { CodeEditor } from '@/components/code-editor'
import { StatusBadge } from '@/components/room-tabs'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardHeader, PageLoader } from '@/components/ui/card'
import { Alert, Field, Input, Textarea } from '@/components/ui/form'
import { Dialog, useFeedback } from '@/components/ui/overlay'
import { api, errorMessage, formatDate, formatDuration, languageLabel, letter, type Sample } from '@/lib/api'
import { cn } from '@/lib/utils'

type Item =
  | { index: number; questionId: string; type: 'mcq' | 'tf'; text: string; options: string[]; correctIndex: number | null; selected: number | null; explanation: string; marks?: number; bloom?: string | null }
  | { index: number; questionId: string; type: 'coding'; title: string; text: string; points: number; samples: Sample[]; answer: { language: string; code: string } | null; marks: number | null; feedback: string }
  | { index: number; questionId: string; type: 'removed'; text: string }

type Detail = {
  room: { id: string; title: string; code: string; marksPerQuestion: number; negativeMarks: number; maxViolations: number }
  integrity: { flags: Flags; violations: number; score: number; level: RiskLevel; events: { type: IntegrityEvent; at: string; detail: string }[]; ipAddresses: string[]; userAgent: string }
  attempt: { id: string; studentName: string; studentEmail: string; rollNumber: string; prn: string; className: string; set: string; status: 'in_progress' | 'submitted'; autoSubmitted: boolean; autoSubmitReason: string; startedAt: string; submittedAt: string | null; tabSwitches: number; mcqScore: number; codingScore: number; codingPending: number; correctCount: number; wrongCount: number; score: number; maxScore: number }
  items: Item[]
}

export default function AttemptReviewPage({ params }: { params: Promise<{ id: string; attemptId: string }> }) {
  const { id, attemptId } = use(params)
  const { toast } = useFeedback()
  const [data, setData] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [grades, setGrades] = useState<Record<string, { marks: string; feedback: string }>>({})
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<'all' | 'coding' | 'wrong'>('all')
  const [reopenOpen, setReopenOpen] = useState(false)
  const [reopenMinutes, setReopenMinutes] = useState('15')

  function apply(detail: Detail) {
    setData(detail)
    setGrades(Object.fromEntries(detail.items.filter(i => i.type === 'coding').map(i => [i.questionId, { marks: (i as Extract<Item, { type: 'coding' }>).marks?.toString() ?? '', feedback: (i as Extract<Item, { type: 'coding' }>).feedback }])))
  }
  useEffect(() => { api<Detail>(`/api/rooms/${id}/attempts/${attemptId}`).then(apply).catch(err => setError(errorMessage(err))) }, [id, attemptId])

  const coding = useMemo(() => (data?.items.filter(i => i.type === 'coding') ?? []) as Extract<Item, { type: 'coding' }>[], [data])
  const dirty = coding.some(i => (grades[i.questionId]?.marks ?? '') !== (i.marks?.toString() ?? '') || (grades[i.questionId]?.feedback ?? '') !== i.feedback)

  async function save() {
    setSaving(true)
    try {
      const marks = coding.map(i => ({ questionId: i.questionId, marks: grades[i.questionId]?.marks === '' ? null : Number(grades[i.questionId]?.marks), feedback: grades[i.questionId]?.feedback ?? '' }))
      apply(await api<Detail>(`/api/rooms/${id}/attempts/${attemptId}`, { method: 'PATCH', body: { marks } }))
      toast('Marks saved. The leaderboard is updated.')
    } catch (err) { toast(errorMessage(err), 'error') } finally { setSaving(false) }
  }

  async function reopen() {
    try {
      apply(await api<Detail>(`/api/rooms/${id}/attempts/${attemptId}`, { method: 'PATCH', body: { action: 'reopen', minutes: Number(reopenMinutes) } }))
      setReopenOpen(false)
      toast(`${data?.attempt.studentName} can continue for ${reopenMinutes} minutes. They should reopen the exam from their dashboard.`)
    } catch (err) { toast(errorMessage(err), 'error') }
  }

  if (error) return <Alert>{error}</Alert>
  if (!data) return <PageLoader />
  const { attempt, room, integrity } = data
  const items = data.items.filter(i => filter === 'all' || (filter === 'coding' ? i.type === 'coding' : i.type !== 'coding' && i.type !== 'removed' && (i as { selected: number | null }).selected !== (i as { correctIndex: number | null }).correctIndex))

  return (
    <>
      <div className="mb-6">
        <div className="text-[13px] text-muted-foreground"><Link href="/teacher/rooms" className="hover:text-foreground">Exam rooms</Link> / <Link href={`/teacher/rooms/${room.id}?tab=leaderboard`} className="hover:text-foreground">{room.title}</Link></div>
        <div className="mt-1.5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-medium tracking-tight">{attempt.studentName}</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">{[attempt.set && `Set ${attempt.set}`, attempt.rollNumber && `Roll ${attempt.rollNumber}`, attempt.prn && `PRN ${attempt.prn}`, attempt.className, attempt.studentEmail].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="flex gap-2">
            {attempt.status === 'submitted' && <Button variant="outline" onClick={() => setReopenOpen(true)}><PlayCircle />Allow to continue</Button>}
            {coding.length > 0 && <Button onClick={save} disabled={!dirty || saving}><Save />{saving ? 'Saving…' : 'Save marks'}</Button>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex flex-col gap-4">
          <div className="flex gap-1.5">
            {([['all', `All (${data.items.length})`], ['wrong', 'Wrong / skipped MCQs'], ['coding', `Coding (${coding.length})`]] as const).map(([value, label]) => (
              <button key={value} onClick={() => setFilter(value)} className={cn('rounded-full border px-3 py-1 text-[13px] font-medium', filter === value ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-card text-muted-foreground hover:text-foreground')}>{label}</button>
            ))}
          </div>
          {items.map(item => (
            <Card key={item.index}>
              {item.type === 'removed' ? <p className="p-5 text-sm text-muted-foreground">Q{item.index + 1}. {item.text}</p> : item.type === 'coding' ? (
                <CodingReview item={item} grade={grades[item.questionId] ?? { marks: '', feedback: '' }} onGrade={value => setGrades(g => ({ ...g, [item.questionId]: value }))} />
              ) : (
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm leading-6"><span className="mr-2 font-mono text-xs text-subtle">Q{item.index + 1}</span>{item.text}</p>
                    {item.selected === null ? <Badge><Minus className="size-3" />Skipped</Badge> : item.selected === item.correctIndex ? <Badge tone="green"><Check className="size-3" />+{item.marks ?? room.marksPerQuestion}</Badge> : <Badge tone="red"><X className="size-3" />{room.negativeMarks ? `−${room.negativeMarks}` : '0'}</Badge>}
                  </div>
                  <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                    {item.options.map((option, i) => {
                      const correct = i === item.correctIndex
                      const chosen = i === item.selected
                      return (
                        <li key={i} className={cn('flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-[13px]', correct ? 'border-success-border bg-success-soft text-success-ink' : chosen ? 'border-danger-border bg-danger-soft text-danger-ink' : 'border-border text-muted-foreground')}>
                          <span className="font-mono text-xs font-semibold">{letter(i)}</span><span className="flex-1">{option}</span>
                          {chosen && <span className="text-[11px] font-semibold uppercase">Chosen</span>}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </Card>
          ))}
          {items.length === 0 && <Card className="p-10 text-center text-sm text-muted-foreground">Nothing in this filter.</Card>}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <IntegrityReport integrity={integrity} maxViolations={room.maxViolations} autoSubmitReason={attempt.autoSubmitReason} />
          <Card>
            <CardHeader title="Score" />
            <div className="p-5">
              <p className="text-3xl font-semibold tabular-nums">{attempt.score}<span className="text-lg font-normal text-muted-foreground"> / {attempt.maxScore}</span></p>
              <dl className="mt-4 flex flex-col gap-2 text-[13px]">
                <Row label="MCQ score" value={attempt.mcqScore} />
                <Row label="Correct / wrong" value={<><span className="text-success">{attempt.correctCount}</span> / <span className="text-danger">{attempt.wrongCount}</span></>} />
                <Row label="Coding score" value={attempt.codingScore} />
                {attempt.codingPending > 0 && <Row label="Still to grade" value={<Badge tone="violet">{attempt.codingPending}</Badge>} />}
              </dl>
            </div>
          </Card>
          <Card>
            <CardHeader title="Attempt" />
            <dl className="flex flex-col gap-2 p-5 text-[13px]">
              <Row label="Status" value={<StatusBadge row={attempt} />} />
              <Row label="Started" value={formatDate(attempt.startedAt, true)} />
              <Row label="Submitted" value={attempt.submittedAt ? formatDate(attempt.submittedAt, true) : '—'} />
              <Row label="Time taken" value={attempt.submittedAt ? formatDuration(Math.round((new Date(attempt.submittedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000)) : '—'} />
            </dl>
          </Card>
        </aside>
      </div>

      <Dialog open={reopenOpen} onClose={() => setReopenOpen(false)} size="sm" title={`Let ${attempt.studentName} continue?`}
        description="Use this after a wrongful auto-submit or a technical problem. The student keeps their answers and their flags, and gets a new end time."
        footer={<><Button variant="outline" onClick={() => setReopenOpen(false)}>Cancel</Button><Button onClick={reopen}>Allow {reopenMinutes} more minutes</Button></>}>
        <Field label="Minutes from now"><Input type="number" min={1} max={300} value={reopenMinutes} onChange={e => setReopenMinutes(e.target.value)} /></Field>
      </Dialog>
    </>
  )
}

function IntegrityReport({ integrity, maxViolations, autoSubmitReason }: { integrity: Detail['integrity']; maxViolations: number; autoSubmitReason: string }) {
  const [showAll, setShowAll] = useState(false)
  const events = showAll ? integrity.events : integrity.events.slice(0, 8)
  return (
    <Card className={cn(integrity.level === 'high' && 'border-danger-border', integrity.level === 'medium' && 'border-warning-border')}>
      <CardHeader title="Integrity report" action={<RiskBadge level={integrity.level} score={integrity.score} />} />
      <div className="flex flex-col gap-4 p-5">
        {autoSubmitReason === 'violations' && <Alert>Auto-submitted after reaching {maxViolations} violations.</Alert>}
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="text-muted-foreground">Violations</span>
          <span className="font-semibold tabular-nums">{integrity.violations}{maxViolations ? <span className="font-normal text-muted-foreground"> / {maxViolations} limit</span> : ''}</span>
        </div>
        {integrity.level === 'clean' ? <p className="text-[13px] text-success">No suspicious activity was recorded.</p> : <FlagChips flags={integrity.flags} />}
        {integrity.events.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-subtle">Timeline</p>
            <ol className="flex flex-col gap-2 border-l border-border pl-3">
              {events.map((event, i) => {
                const Icon = EVENT_ICONS[event.type] ?? Check
                return (
                  <li key={i} className="relative text-xs">
                    <span className={cn('absolute -left-[17px] top-0.5 flex size-2 rounded-full', INTEGRITY_EVENTS[event.type]?.violation ? 'bg-danger' : 'bg-border-strong')} />
                    <p className="flex items-center gap-1.5 font-medium"><Icon className="size-3 text-muted-foreground" />{INTEGRITY_EVENTS[event.type]?.label ?? event.type}</p>
                    <p className="text-muted-foreground">{new Date(event.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}{event.detail && ` · ${event.detail}`}</p>
                  </li>
                )
              })}
            </ol>
            {integrity.events.length > 8 && <button onClick={() => setShowAll(v => !v)} className="mt-2 text-xs font-medium text-primary">{showAll ? 'Show less' : `Show all ${integrity.events.length}`}</button>}
          </div>
        )}
        <div className="border-t border-border pt-3 text-xs text-muted-foreground">
          <p><span className="font-medium text-foreground">IP address{integrity.ipAddresses.length === 1 ? '' : 'es'}:</span> {integrity.ipAddresses.join(', ') || '—'}</p>
          {integrity.userAgent && <p className="mt-1 break-words"><span className="font-medium text-foreground">Browser:</span> {integrity.userAgent}</p>}
        </div>
      </div>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium tabular-nums">{value}</dd></div>
}

function CodingReview({ item, grade, onGrade }: { item: Extract<Item, { type: 'coding' }>; grade: { marks: string; feedback: string }; onGrade: (value: { marks: string; feedback: string }) => void }) {
  const [showStatement, setShowStatement] = useState(false)
  const lines = item.answer?.code.split('\n').length ?? 0
  return (
    <div>
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold"><Code2 className="size-4 text-violet" /><span className="font-mono text-xs font-normal text-subtle">Q{item.index + 1}</span>{item.title}</p>
          <button onClick={() => setShowStatement(v => !v)} className="mt-1 inline-flex items-center gap-1 text-xs text-primary">{showStatement ? 'Hide' : 'Show'} problem <ChevronDown className={cn('size-3 transition-transform', showStatement && 'rotate-180')} /></button>
        </div>
        {item.marks == null ? (item.answer ? <Badge tone="violet">Needs grading</Badge> : <Badge>Not attempted</Badge>) : <Badge tone="green">{item.marks} / {item.points}</Badge>}
      </div>
      {showStatement && <p className="whitespace-pre-wrap border-b border-border bg-muted/40 px-5 py-3 text-[13px] leading-6">{item.text}</p>}
      {item.answer ? (
        <div className="overflow-hidden border-b border-border">
          <div className="flex items-center justify-between bg-[#252526] px-4 py-1.5 text-xs text-white/70"><span>{languageLabel(item.answer.language)}</span><span>{lines} lines</span></div>
          <CodeEditor value={item.answer.code} language={item.answer.language} readOnly height={Math.min(480, Math.max(140, lines * 20 + 30))} />
        </div>
      ) : <p className="border-b border-border px-5 py-6 text-center text-sm text-muted-foreground">No code was written for this problem.</p>}
      <div className="grid gap-3 p-5 sm:grid-cols-[140px_1fr]">
        <label className="text-[13px] font-medium">Marks <span className="font-normal text-muted-foreground">/ {item.points}</span>
          <Input className="mt-1.5" type="number" min={0} max={item.points} step={0.5} value={grade.marks} onChange={e => onGrade({ ...grade, marks: e.target.value })} placeholder="—" />
        </label>
        <label className="text-[13px] font-medium">Feedback <span className="font-normal text-muted-foreground">(visible to the student)</span>
          <Textarea className="mt-1.5 min-h-9" rows={1} value={grade.feedback} onChange={e => onGrade({ ...grade, feedback: e.target.value })} placeholder="Optional comment" />
        </label>
      </div>
    </div>
  )
}

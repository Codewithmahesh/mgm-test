'use client'

import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { BadgeCheck, Check, Clock3, Code2, ListChecks, Mail, PenLine, ScanSearch, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/card'
import { useFeedback } from '@/components/ui/overlay'
import { TeacherContext } from '@/components/role-context'
import { ApiError, api, errorMessage, type DraftQuestion } from '@/lib/api'
import { BLOOM_INFO, BLOOM_LEVELS, bloomLabel } from '@/lib/bloom'
import { cn } from '@/lib/utils'
import type { GenerationPlan } from '@/components/add-questions'

/** What was asked for, to describe the work while it happens. */
export type GenerationRequest = {
  /** MCQs at each Bloom level, all sets together. */
  levels: number[]
  coding: number
  sets: string[]
  /** File names (or "your notes") the questions come from. */
  sources: string[]
  topic: string
}

type JobSummary = {
  id: string
  status: 'running' | 'ready' | 'failed' | 'saved' | 'cancelled'
  background: boolean
  progress: { total: number; done: number; failed: number; running: number; waiting: number }
  error: string
}
type RunResult = { claimed: boolean; busy: boolean; questions: DraftQuestion[]; error: string; job: JobSummary }

// Browser-driven calls at once (the server runs one part per call).
const PARALLEL = 4
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * The generation screen. Drives a foreground job part by part and shows what is being written.
 * If the AI is busy, or it takes longer than expected, it offers to hand the job to the server,
 * which finishes it and emails the faculty member.
 */
export function GenerationProgress({ jobId, request, onReady, onBackground, onStop }: {
  jobId: string
  request: GenerationRequest
  onReady: (questions: DraftQuestion[], plan: GenerationPlan) => void
  onBackground: () => void
  /** The job ended without drafts to review; the message (if any) explains why. */
  onStop: (message: string) => void
}) {
  const { confirm } = useFeedback()
  const teacher = useContext(TeacherContext)
  const [job, setJob] = useState<JobSummary | null>(null)
  const [written, setWritten] = useState<DraftQuestion[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [handingOff, setHandingOff] = useState(false)
  // Set once the outcome is decided (ready, failed, background, cancelled) so every worker stops.
  const settled = useRef(false)
  const callbacks = useRef({ onReady, onBackground, onStop })
  callbacks.current = { onReady, onBackground, onStop }

  const mcqTotal = request.levels.reduce((a, b) => a + b, 0)
  const total = mcqTotal + request.coding
  // Rough time to expect: parts run four at a time; longer parts and coding problems take longer.
  const expected = useMemo(() => {
    const parts = Math.max(1, Math.ceil(mcqTotal / 60), Math.ceil(request.coding / 10))
    const perPart = 25 + 0.6 * Math.min(mcqTotal / parts, 60) + 6 * Math.min(request.coding / parts, 10)
    return Math.ceil(parts / PARALLEL) * perPart
  }, [mcqTotal, request.coding])
  const [slowAt, setSlowAt] = useState(() => Math.max(60, Math.round(expected * 1.5)))

  const email = teacher?.email ?? 'your email'

  async function toBackground() {
    setHandingOff(true)
    try {
      await api(`/api/generation-jobs/${jobId}`, { method: 'PATCH', body: { action: 'background' } })
      callbacks.current.onBackground()
    } catch (err) {
      // Finished in the meantime: show it.
      if (err instanceof ApiError && err.status === 409) { settled.current = false; await finish() }
      else { setHandingOff(false); callbacks.current.onStop(errorMessage(err)) }
    }
  }

  async function cancel(message: string) {
    await api(`/api/generation-jobs/${jobId}`, { method: 'DELETE' }).catch(() => {})
    callbacks.current.onStop(message)
  }

  async function finish() {
    if (settled.current) return
    settled.current = true
    try {
      const data = await api<{ job: JobSummary; questions?: DraftQuestion[]; plan?: GenerationPlan }>(`/api/generation-jobs/${jobId}`)
      if (data.job.status === 'ready' && data.questions?.length && data.plan) callbacks.current.onReady(data.questions.map(q => ({ ...q, set: q.set ?? '' })), data.plan)
      else callbacks.current.onStop(data.job.error || 'The AI could not generate questions this time. Please try again.')
    } catch (err) { callbacks.current.onStop(errorMessage(err)) }
  }

  async function busy() {
    if (settled.current) return
    settled.current = true
    const yes = await confirm({
      title: 'The AI is under heavy load right now',
      description: <>So many requests are being processed that we can&apos;t generate your questions at the moment. <b>Want us to take care of it?</b> We&apos;ll keep trying in the background and email <b>{email}</b> as soon as they&apos;re ready to review. You can close this tab safely; there&apos;s no need to come back and try again.</>,
      confirmLabel: 'Yes, generate in the background',
      cancelLabel: 'No, cancel',
    })
    if (yes) await toBackground()
    else await cancel('Generation cancelled. The AI is busy right now; please try again in a few minutes.')
  }

  // Workers: keep asking the server to run the next part until the job is finished.
  useEffect(() => {
    let cancelled = false
    const worker = async () => {
      let failures = 0
      while (!cancelled && !settled.current) {
        let result: RunResult
        try {
          result = await api<RunResult>(`/api/generation-jobs/${jobId}/run`, { method: 'POST' })
          failures = 0
        } catch (err) {
          if (cancelled || settled.current) return
          if (err instanceof ApiError && err.status === 404) { settled.current = true; callbacks.current.onStop('This generation was cancelled.'); return }
          // A dropped connection or a server hiccup: the part is picked up again, so just retry.
          if (++failures >= 5) { settled.current = true; callbacks.current.onStop(errorMessage(err)); return }
          await sleep(3000)
          continue
        }
        if (cancelled || settled.current) return
        setJob(result.job)
        if (result.questions.length) setWritten(list => [...list, ...result.questions])
        if (result.busy) return void busy()
        if (result.job.status !== 'running') return void finish()
        if (!result.claimed) await sleep(2500)
      }
    }
    for (let i = 0; i < PARALLEL; i++) void worker()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  useEffect(() => {
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])

  // Progress: finished parts, eased forward by the time so far so a single long part doesn't look stuck.
  const parts = job?.progress.total ?? Math.max(1, Math.ceil(mcqTotal / 60), Math.ceil(request.coding / 10))
  const done = (job?.progress.done ?? 0) + (job?.progress.failed ?? 0)
  const estimate = 0.9 * (1 - Math.exp((-1.6 * elapsed) / Math.max(30, expected)))
  const percent = Math.min(97, Math.round(Math.max(done / parts, estimate) * 100))

  const range = request.sets.length ? `${request.sets[0]}–${request.sets.at(-1)}` : ''
  const stages = [
    { icon: ScanSearch, label: request.sources.length ? `Reading ${request.sources.length > 1 ? `${request.sources.length} documents` : request.sources[0]}` : `Understanding “${request.topic.slice(0, 60)}”` },
    { icon: ListChecks, label: "Mapping key concepts to Bloom's levels" },
    { icon: PenLine, label: `Writing ${total} question${total === 1 ? '' : 's'}${parts > 1 ? ` in ${parts} parts` : ''}` },
    { icon: BadgeCheck, label: range ? `Checking answers and dealing into sets ${range}` : 'Checking answers and removing duplicates' },
  ]
  const stage = done >= parts ? 3 : done > 0 || written.length ? 2 : percent < 8 ? 0 : percent < 18 ? 1 : 2

  // A rotating line about what the AI is doing right now.
  const messages = useMemo(() => {
    const list: string[] = []
    BLOOM_LEVELS.forEach((level, i) => { if (request.levels[i]) list.push(`Writing L${BLOOM_INFO[level].n} ${BLOOM_INFO[level].label} questions: ${BLOOM_INFO[level].hint.toLowerCase()}`) })
    if (mcqTotal) list.push('Making sure every MCQ has exactly one correct answer', 'Writing believable wrong options from common mistakes', 'Varying where the correct option sits')
    if (request.coding) list.push('Designing coding problems with clear input and output formats', 'Working out the exact output of every sample test')
    if (range) list.push(`Keeping sets ${range} equally difficult`)
    request.sources.slice(0, 3).forEach(source => list.push(`Pulling key ideas from ${source}`))
    return list
  }, [request, mcqTotal, range])
  const message = messages[Math.floor(elapsed / 3) % messages.length]

  const writtenMcq = written.filter(q => q.type !== 'coding')
  const writtenCoding = written.length - writtenMcq.length
  const recent = written.slice(-4).reverse()
  const slow = elapsed >= slowAt && !handingOff
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <div className="relative flex size-12 shrink-0 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/20 [animation-duration:2s]" />
          <span className="relative flex size-12 items-center justify-center rounded-full bg-primary-soft"><Sparkles className="size-5 animate-pulse text-primary" /></span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">Generating {total} question{total === 1 ? '' : 's'}{range ? ` in ${request.sets.length} sets` : ''}</p>
          <p key={message} className="mt-0.5 animate-float-in truncate text-[13px] text-muted-foreground">{message}…</p>
        </div>
        <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums text-muted-foreground"><Clock3 className="size-3.5" />{clock}</span>
      </div>

      <div>
        <div className="relative h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out" style={{ width: `${percent}%` }} />
          <div className="absolute inset-y-0 left-0 w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        </div>
        <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
          <span>{parts > 1 ? `${done} of ${parts} parts done` : 'Working on it'}</span>
          <span className="tabular-nums">{percent}%</span>
        </div>
      </div>

      <ol className="flex flex-col gap-2.5">
        {stages.map((item, i) => (
          <li key={item.label} className={cn('flex items-center gap-3 text-sm transition-colors', i > stage && 'text-muted-foreground/60')}>
            <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full border transition-all duration-500',
              i < stage ? 'border-success bg-success text-white' : i === stage ? 'border-primary bg-primary-soft text-primary' : 'border-border')}>
              {i < stage ? <Check className="size-3.5" /> : <item.icon className={cn('size-3.5', i === stage && 'animate-pulse')} />}
            </span>
            <span className={cn(i === stage && 'font-medium')}>{item.label}</span>
            {i === stage && <span className="flex gap-0.5">{[0, 1, 2].map(d => <span key={d} className="size-1 animate-pulse rounded-full bg-primary" style={{ animationDelay: `${d * 200}ms` }} />)}</span>}
          </li>
        ))}
      </ol>

      <div className="grid gap-2 sm:grid-cols-2">
        {mcqTotal > 0 && <Counter label="MCQs written" value={writtenMcq.length} total={mcqTotal} />}
        {request.coding > 0 && <Counter label="Coding problems written" value={writtenCoding} total={request.coding} icon={Code2} />}
      </div>
      {mcqTotal > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {BLOOM_LEVELS.map((level, i) => request.levels[i] ? (
            <Badge key={level} tone={BLOOM_INFO[level].tone}>L{BLOOM_INFO[level].n} {BLOOM_INFO[level].label} · {writtenMcq.filter(q => q.bloom === level).length}/{request.levels[i]}</Badge>
          ) : null)}
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Just written</p>
          <ul className="flex flex-col gap-1.5">
            {recent.map((q, i) => (
              <li key={`${written.length}-${i}`} className="flex animate-float-in items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-[13px]" style={{ animationDelay: `${i * 80}ms` }}>
                {q.type === 'coding' ? <Code2 className="mt-0.5 size-3.5 shrink-0 text-violet" /> : <PenLine className="mt-0.5 size-3.5 shrink-0 text-primary" />}
                <span className="line-clamp-2 min-w-0 flex-1">{q.type === 'coding' ? q.title || q.text : q.text}</span>
                {q.bloom && <span className="shrink-0 text-[11px] text-muted-foreground">{bloomLabel(q.bloom)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {slow && (
        <div className="animate-float-in rounded-lg border border-warning-border bg-warning-soft p-4">
          <p className="text-sm font-semibold text-warning-ink">This is taking longer than usual</p>
          <p className="mt-1 text-[13px] leading-5 text-warning-ink/90">The AI is slower than normal right now. You can keep waiting, or let us finish it in the background: you can then close this tab safely, and we&apos;ll email <b>{email}</b> when the questions are ready to review and add.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { settled.current = true; void toBackground() }}><Mail />Continue in background</Button>
            <Button size="sm" variant="outline" onClick={() => setSlowAt(elapsed + 120)}>Keep waiting</Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>Don&apos;t want to wait? Run it in the background, close the tab, and we&apos;ll email you.</span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={handingOff} onClick={async () => {
            if (await confirm({ title: 'Cancel this generation?', description: 'Questions written so far will be discarded.', confirmLabel: 'Cancel generation', cancelLabel: 'Keep going', tone: 'danger' })) { settled.current = true; await cancel('') }
          }}>Cancel</Button>
          <Button size="sm" variant="outline" disabled={handingOff} onClick={() => { settled.current = true; void toBackground() }}><Mail />Run in background</Button>
        </div>
      </div>
    </div>
  )
}

function Counter({ label, value, total, icon: Icon = PenLine }: { label: string; value: number; total: number; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><Icon className="size-3.5" />{label}</span><span className="font-mono tabular-nums text-foreground">{Math.min(value, total)}/{total}</span></div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${Math.min(100, (value / Math.max(1, total)) * 100)}%` }} /></div>
    </div>
  )
}

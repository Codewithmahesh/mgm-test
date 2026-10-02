'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, CircleX, FileText, Loader2, Mail, MoonStar, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, Field, Input, Select, Textarea } from '@/components/ui/form'
import { Dialog, useFeedback } from '@/components/ui/overlay'
import { api, errorMessage, relativeTime } from '@/lib/api'
import type { FacultyExperiment, PracticalJob, Problem } from '@/lib/practical-types'
import { cn } from '@/lib/utils'

export type Level = 'easy' | 'medium' | 'hard'

const LEVELS: { value: Level; label: string; hint: string }[] = [
  { value: 'easy', label: 'Easy', hint: 'Direct use of the concept, small inputs' },
  { value: 'medium', label: 'Medium', hint: 'A typical lab exercise with a few edge cases' },
  { value: 'hard', label: 'Hard', hint: 'Edge cases and larger inputs; efficiency matters' },
]

/** Easy / Medium / Hard, with what each means. */
export function LevelPicker({ value, onChange, compact = false }: { value: Level; onChange: (level: Level) => void; compact?: boolean }) {
  return (
    <div className={cn('grid gap-2', compact ? 'grid-cols-3' : 'sm:grid-cols-3')} role="radiogroup" aria-label="Difficulty level">
      {LEVELS.map(level => (
        <button key={level.value} type="button" role="radio" aria-checked={value === level.value} onClick={() => onChange(level.value)}
          className={cn('rounded-lg border px-3 py-2.5 text-left transition-colors', value === level.value ? 'border-primary bg-primary-soft/60 ring-1 ring-primary' : 'border-border hover:bg-muted')}>
          <div className="text-sm font-semibold">{level.label}</div>
          {!compact && <div className="mt-0.5 text-xs text-muted-foreground">{level.hint}</div>}
        </button>
      ))}
    </div>
  )
}

/**
 * The AI drafts one experiment for this practical. It sees the subject and the existing experiments, so the
 * draft fits the sequence; the faculty member picks the level and can base it on an existing experiment.
 */
export function AiDraftDialog({ subjectId, experiments, open, onClose, onDraft, onBackground }: { subjectId: string; experiments: FacultyExperiment[]; open: boolean; onClose: () => void; onDraft: (problem: Partial<Problem>) => void; onBackground: () => void }) {
  const [topic, setTopic] = useState('')
  const [description, setDescription] = useState('')
  const [level, setLevel] = useState<Level>('medium')
  const [basis, setBasis] = useState('')
  const [busy, setBusy] = useState<'draft' | 'background' | null>(null)
  const [error, setError] = useState('')

  /** What to ask the AI for, or null (with an error shown) when there's nothing to go on. */
  function request() {
    const base = experiments.find(e => e.id === basis)
    if (!topic.trim() && !description.trim() && !base) { setError('Enter the experiment topic, or choose an experiment to build on.'); return null }
    const instructions = [description, base ? `Build on experiment ${base.order}, "${base.title}": take the same idea one step further.` : ''].filter(Boolean).join('\n')
    return { topic: topic || base?.topic || base?.title || '', description: instructions }
  }
  function reset() { setTopic(''); setDescription(''); setBasis('') }

  async function generate() {
    const body = request()
    if (!body) return
    setBusy('draft')
    setError('')
    try {
      const { problem } = await api<{ problem: Partial<Problem> }>(`/api/practicals/${subjectId}/generate`, { body: { mode: 'draft', ...body, level } })
      onDraft(problem)
      reset()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(null) }
  }

  /** The server writes it and adds it as the next experiment; the faculty member is emailed at the start and the end. */
  async function background() {
    const body = request()
    if (!body) return
    setBusy('background')
    setError('')
    try {
      await api(`/api/practicals/${subjectId}/jobs`, { body: { kind: 'draft', level, items: [{ title: body.topic, description: body.description }] } })
      reset()
      onBackground()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(null) }
  }

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Draft an experiment with AI" description="The AI uses this practical's subject and existing experiments, writes the problem with sample and hidden tests, and you review it before it's added."
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="outline" onClick={background} loading={busy === 'background'} disabled={busy === 'draft'}><MoonStar />Run in background</Button>
        <Button onClick={generate} loading={busy === 'draft'} disabled={busy === 'background'}><Sparkles />{busy === 'draft' ? 'Writing…' : 'Draft experiment'}</Button>
      </>}>
      <div className="flex flex-col gap-5">
        {error && <Alert>{error}</Alert>}
        <BackgroundHint>Don&apos;t want to wait? <b>Run in background</b> writes it and adds it as the next experiment without a review step; we email you when it starts and when it&apos;s done.</BackgroundHint>
        <Field label="Topic"><Input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Stack using arrays" autoFocus /></Field>
        <Field label="Level"><LevelPicker value={level} onChange={setLevel} /></Field>
        {experiments.length > 0 && (
          <Field label="Build on an experiment" hint="Optional: the new one continues from it.">
            <Select value={basis} onChange={e => setBasis(e.target.value)}>
              <option value="">None (a new topic)</option>
              {experiments.map(e => <option key={e.id} value={e.id}>{e.order}. {e.title}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Instructions" hint="Optional: what it should practise, input size, anything to avoid…"><Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} /></Field>
      </div>
    </Dialog>
  )
}

type Item = { key: number; title: string; aim: string; include: boolean; state: 'idle' | 'working' | 'done' | 'failed'; error?: string }
const ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp'
const MAX_BYTES = 4 * 1024 * 1024

/**
 * Import a practical list: upload a photo, PDF or Word file of the list, review the experiments the AI found,
 * choose the level, and the AI writes each one (statement, sample and hidden tests) and adds it in order.
 */
export function ImportListDialog({ subjectId, open, onClose, onAdded, onBackground }: { subjectId: string; open: boolean; onClose: () => void; onAdded: () => void; onBackground: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [items, setItems] = useState<Item[] | null>(null)
  const [level, setLevel] = useState<Level>('medium')
  const [reading, setReading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [moving, setMoving] = useState(false)
  // Set when the faculty member moves the rest to the background: the loop stops after the current item.
  const stop = useRef(false)
  const [error, setError] = useState('')
  // runInBackground waits for the item in progress and then reads the latest list, not this render's copy.
  const addingRef = useRef(false)
  const itemsRef = useRef<Item[] | null>(null)
  const finished = Boolean(items?.length) && items!.filter(i => i.include).every(i => i.state === 'done' || i.state === 'failed') && items!.some(i => i.state !== 'idle')

  function reset() { setFiles([]); setItems(null); setError(''); setReading(false); setAdding(false); setMoving(false); stop.current = false }
  function close() { if (adding) return; if (finished) onAdded(); reset(); onClose() }

  function pick(list: FileList | null) {
    if (!list) return
    const next = [...files, ...Array.from(list)].slice(0, 10)
    if (next.reduce((sum, f) => sum + f.size, 0) > MAX_BYTES) return setError('The files add up to more than 4 MB. Use a smaller photo or fewer pages.')
    setError('')
    setFiles(next)
  }

  async function read() {
    if (!files.length) return setError('Choose a photo, PDF or Word file of the practical list.')
    setReading(true)
    setError('')
    try {
      const form = new FormData()
      files.forEach(file => form.append('files', file))
      const { experiments } = await api<{ experiments: { title: string; aim: string }[] }>(`/api/practicals/${subjectId}/import`, { body: form })
      setItems(experiments.map((e, i) => ({ key: i, title: e.title, aim: e.aim, include: true, state: 'idle' })))
    } catch (err) { setError(errorMessage(err)) } finally { setReading(false) }
  }

  useEffect(() => { itemsRef.current = items }, [items])
  const update = (key: number, patch: Partial<Item>) => setItems(list => list?.map(i => (i.key === key ? { ...i, ...patch } : i)) ?? null)

  /** Writes and adds the chosen experiments, in order, a couple at a time. */
  async function add() {
    if (!items) return
    const queue = items.filter(i => i.include && i.state !== 'done' && (i.title.trim() || i.aim.trim()))
    if (!queue.length) return setError('Choose at least one experiment to add.')
    setAdding(true)
    addingRef.current = true
    setError('')
    stop.current = false
    // One at a time: each is appended as the next level, so the list's order is kept.
    for (const item of queue) {
      if (stop.current) break
      update(item.key, { state: 'working', error: undefined })
      try {
        await api(`/api/practicals/${subjectId}/generate`, { body: { mode: 'experiment', topic: item.title, description: `Aim of this experiment, from the practical list: ${item.aim || item.title}`, level } })
        update(item.key, { state: 'done' })
      } catch (err) { update(item.key, { state: 'failed', error: errorMessage(err) }) }
    }
    addingRef.current = false
    setAdding(false)
  }

  /**
   * Hands the chosen experiments that aren't added yet to the server, which writes and adds them in order
   * and emails the faculty member when it starts and when it's done. While adding here, the one being
   * written finishes first, so nothing is added twice.
   */
  async function runInBackground() {
    if (!items) return
    setMoving(true)
    setError('')
    stop.current = true
    while (addingRef.current) await new Promise(resolve => setTimeout(resolve, 300))
    const latest = itemsRef.current ?? []
    const rest = latest.filter(i => i.include && i.state !== 'done' && (i.title.trim() || i.aim.trim()))
    // Everything got added meanwhile: nothing left for the background.
    if (!rest.length) {
      if (latest.some(i => i.state === 'done')) onAdded()
      reset()
      return onClose()
    }
    try {
      await api(`/api/practicals/${subjectId}/jobs`, { body: { kind: 'import', level, items: rest.map(i => ({ title: i.title, description: `Aim of this experiment, from the practical list: ${i.aim || i.title}` })) } })
      if (latest.some(i => i.state === 'done')) onAdded()
      reset()
      onBackground()
    } catch (err) { setError(errorMessage(err)); setMoving(false); stop.current = false }
  }

  const chosen = items?.filter(i => i.include).length ?? 0
  const done = items?.filter(i => i.state === 'done').length ?? 0

  return (
    <Dialog open={open} onClose={close} size="full" dismissible={!adding} title="Import the practical list"
      description="Upload the list of practicals (a photo, scan, PDF or Word file). The AI finds the experiments; you check them, choose the level, and each one is written with its tests and added in order."
      footer={!items ? (
        <><Button variant="outline" onClick={close}>Cancel</Button><Button onClick={read} loading={reading} disabled={!files.length}><Sparkles />{reading ? 'Reading the list…' : 'Read the list'}</Button></>
      ) : finished && !adding ? (
        <><Button variant="outline" onClick={() => setItems(list => list?.map(i => (i.state === 'failed' ? { ...i, state: 'idle' } : i)) ?? null)} disabled={!items.some(i => i.state === 'failed')}>Retry failed</Button><Button onClick={close}>Done</Button></>
      ) : (
        <>
          <Button variant="outline" onClick={() => setItems(null)} disabled={adding || moving}>Back</Button>
          <Button variant="outline" onClick={runInBackground} loading={moving} disabled={!chosen}><MoonStar />{adding ? 'Move the rest to background' : 'Run in background'}</Button>
          <Button onClick={add} loading={adding} disabled={!chosen || moving}><Plus />{adding ? `Adding ${done + 1} of ${chosen}…` : `Write and add ${chosen} experiment${chosen === 1 ? '' : 's'}`}</Button>
        </>
      )}>
      <div className="flex flex-col gap-5">
        {error && <Alert>{error}</Alert>}
        {items && !finished && <BackgroundHint>Writing takes about half a minute per experiment. <b>Run in background</b> lets you close this page: the server adds them in order and emails you when it starts and when it&apos;s done.</BackgroundHint>}
        {!items ? (
          <>
            <button type="button" onClick={() => input.current?.click()} className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border-strong bg-muted/40 px-6 py-12 text-center transition-colors hover:border-primary hover:bg-primary-soft/40"
              onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files) }}>
              <Upload className="size-8 text-primary" />
              <span className="text-base font-semibold">Choose or drop the practical list</span>
              <span className="text-sm text-muted-foreground">Photo or scan (.jpg, .png), PDF or Word (.doc, .docx) · up to 4 MB</span>
            </button>
            <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={e => { pick(e.target.files); e.target.value = '' }} />
            {files.length > 0 && (
              <ul className="flex flex-col gap-2">
                {files.map((file, i) => (
                  <li key={`${file.name}-${i}`} className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
                    <FileText className="size-5 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{file.name}</span>
                    <span className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                    <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${file.name}`} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-danger"><X className="size-4" /></button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <Field label="Level for these experiments"><LevelPicker value={level} onChange={setLevel} /></Field>
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-semibold">{items.length} experiment{items.length === 1 ? '' : 's'} found</span>
                <span className="text-muted-foreground">{adding || done ? `${done} of ${chosen} added` : 'Edit or untick any before adding'}</span>
              </div>
              <ol className="flex flex-col gap-3">
                {items.map((item, index) => (
                  <li key={item.key} className={cn('flex gap-3 rounded-lg border p-3', item.state === 'done' ? 'border-success-border bg-success-soft/30' : item.state === 'failed' ? 'border-danger-border bg-danger-soft/30' : 'border-border', !item.include && 'opacity-50')}>
                    <div className="flex flex-col items-center gap-2 pt-1">
                      <input type="checkbox" checked={item.include} disabled={adding || item.state === 'done'} onChange={e => update(item.key, { include: e.target.checked })} className="size-4 accent-[var(--primary)]" aria-label={`Include experiment ${index + 1}`} />
                      <span className="text-xs font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <Input value={item.title} disabled={adding || item.state === 'done'} onChange={e => update(item.key, { title: e.target.value })} placeholder="Experiment title" className="font-medium" />
                      <Textarea rows={2} value={item.aim} disabled={adding || item.state === 'done'} onChange={e => update(item.key, { aim: e.target.value })} placeholder="Aim / what students must write" className="text-[13px]" />
                      {item.error && <p className="text-xs text-danger">{item.error}</p>}
                    </div>
                    <div className="flex w-6 justify-center pt-2">
                      {item.state === 'working' ? <Loader2 className="size-5 animate-spin text-primary" /> : item.state === 'done' ? <CheckCircle2 className="size-5 text-success" /> : item.state === 'failed' ? <CircleX className="size-5 text-danger" />
                        : !adding && <button type="button" onClick={() => setItems(items.filter(i => i.key !== item.key))} aria-label="Remove" className="rounded p-0.5 text-muted-foreground hover:text-danger"><Trash2 className="size-4" /></button>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}

function BackgroundHint({ children }: { children: React.ReactNode }) {
  return <p className="flex items-start gap-2.5 rounded-lg bg-muted/60 px-3 py-2.5 text-[13px] leading-5 text-muted-foreground"><Mail className="mt-0.5 size-4 shrink-0 text-primary" /><span>{children}</span></p>
}

/**
 * Background AI jobs for this practical: progress while they run (checked every few seconds, reloading the
 * experiments as each one is added), then what was added and what failed, until dismissed.
 * Bump `refreshKey` to look again right after starting a job.
 */
export function PracticalJobsBanner({ subjectId, refreshKey, onAdded }: { subjectId: string; refreshKey: number; onAdded: () => void }) {
  const { toast } = useFeedback()
  const [jobs, setJobs] = useState<PracticalJob[]>([])
  const added = useRef<number | null>(null)
  const onAddedRef = useRef(onAdded)
  useEffect(() => { onAddedRef.current = onAdded }, [onAdded])

  const load = useCallback(() => api<{ jobs: PracticalJob[] }>(`/api/practicals/${subjectId}/jobs`).then(d => {
    setJobs(d.jobs)
    const total = d.jobs.reduce((sum, j) => sum + j.done, 0)
    if (added.current !== null && total !== added.current) onAddedRef.current()
    added.current = total
  }).catch(() => { /* the banner is optional; try again on the next check */ }), [subjectId])

  useEffect(() => { void load() }, [load, refreshKey])
  const running = jobs.some(j => j.status === 'running')
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => void load(), 6000)
    return () => window.clearInterval(timer)
  }, [running, load])

  async function remove(job: PracticalJob) {
    try {
      await api(`/api/practicals/${subjectId}/jobs/${job.id}`, { method: 'DELETE' })
      setJobs(list => list.filter(j => j.id !== job.id))
      if (job.status === 'running') toast('Stopped. Experiments already added stay.')
    } catch (err) { toast(errorMessage(err), 'error') }
  }

  if (!jobs.length) return null
  return (
    <div className="mb-5 flex flex-col gap-2">
      {jobs.map(job => {
        const finished = job.status !== 'running'
        const percent = job.total ? Math.round(((job.done + job.failed) / job.total) * 100) : 0
        const failed = job.items.filter(i => i.status === 'failed')
        return (
          <div key={job.id} className={cn('rounded-lg border p-3.5', !finished ? 'border-primary-border bg-primary-soft/40' : failed.length ? 'border-warning-border bg-warning-soft/40' : 'border-success-border bg-success-soft/40')}>
            <div className="flex items-start gap-3">
              {!finished ? <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-primary" /> : failed.length ? <CircleX className="mt-0.5 size-5 shrink-0 text-warning" /> : <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  {!finished ? `Writing in the background: ${job.done} of ${job.total} added` : `${job.done} of ${job.total} experiment${job.total === 1 ? '' : 's'} added in the background`}
                </div>
                <div className="mt-0.5 text-[13px] text-muted-foreground">
                  {!finished
                    ? job.nextRetryAt ? `The AI is busy; trying again ${relativeTime(job.nextRetryAt)}. ${job.lastError}` : job.current ? `Now writing: ${job.current}. You can leave this page; we'll email you when it's done.` : 'Starting…'
                    : `Finished ${relativeTime(job.finishedAt)}. Review the new experiments below.`}
                </div>
                {!finished && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-card"><div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.max(4, percent)}%` }} /></div>}
                {finished && failed.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1 text-[13px]">
                    {failed.map((item, i) => <li key={i} className="text-danger">Not added: <span className="font-medium">{item.title || 'Untitled'}</span>{item.error ? ` (${item.error})` : ''}</li>)}
                  </ul>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => void remove(job)} aria-label={finished ? 'Dismiss' : 'Stop'}>{finished ? <X /> : 'Stop'}</Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

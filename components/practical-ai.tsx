'use client'

import { useRef, useState } from 'react'
import { CheckCircle2, CircleX, FileText, Loader2, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, Field, Input, Select, Textarea } from '@/components/ui/form'
import { Dialog } from '@/components/ui/overlay'
import { api, errorMessage } from '@/lib/api'
import type { FacultyExperiment, Problem } from '@/lib/practical-types'
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
export function AiDraftDialog({ subjectId, experiments, open, onClose, onDraft }: { subjectId: string; experiments: FacultyExperiment[]; open: boolean; onClose: () => void; onDraft: (problem: Partial<Problem>) => void }) {
  const [topic, setTopic] = useState('')
  const [description, setDescription] = useState('')
  const [level, setLevel] = useState<Level>('medium')
  const [basis, setBasis] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function generate() {
    const base = experiments.find(e => e.id === basis)
    if (!topic.trim() && !description.trim() && !base) return setError('Enter the experiment topic, or choose an experiment to build on.')
    setBusy(true)
    setError('')
    try {
      const instructions = [description, base ? `Build on experiment ${base.order}, "${base.title}": take the same idea one step further.` : ''].filter(Boolean).join('\n')
      const { problem } = await api<{ problem: Partial<Problem> }>(`/api/practicals/${subjectId}/generate`, { body: { mode: 'draft', topic: topic || base?.topic || base?.title, description: instructions, level } })
      onDraft(problem)
      setTopic('')
      setDescription('')
      setBasis('')
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Draft an experiment with AI" description="The AI uses this practical's subject and existing experiments, writes the problem with sample and hidden tests, and you review it before it's added."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={generate} loading={busy}><Sparkles />{busy ? 'Writing…' : 'Draft experiment'}</Button></>}>
      <div className="flex flex-col gap-5">
        {error && <Alert>{error}</Alert>}
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
export function ImportListDialog({ subjectId, open, onClose, onAdded }: { subjectId: string; open: boolean; onClose: () => void; onAdded: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [items, setItems] = useState<Item[] | null>(null)
  const [level, setLevel] = useState<Level>('medium')
  const [reading, setReading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const finished = Boolean(items?.length) && items!.filter(i => i.include).every(i => i.state === 'done' || i.state === 'failed') && items!.some(i => i.state !== 'idle')

  function reset() { setFiles([]); setItems(null); setError(''); setReading(false); setAdding(false) }
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

  const update = (key: number, patch: Partial<Item>) => setItems(list => list?.map(i => (i.key === key ? { ...i, ...patch } : i)) ?? null)

  /** Writes and adds the chosen experiments, in order, a couple at a time. */
  async function add() {
    if (!items) return
    const queue = items.filter(i => i.include && i.state !== 'done' && (i.title.trim() || i.aim.trim()))
    if (!queue.length) return setError('Choose at least one experiment to add.')
    setAdding(true)
    setError('')
    // One at a time: each is appended as the next level, so the list's order is kept.
    for (const item of queue) {
      update(item.key, { state: 'working', error: undefined })
      try {
        await api(`/api/practicals/${subjectId}/generate`, { body: { mode: 'experiment', topic: item.title, description: `Aim of this experiment, from the practical list: ${item.aim || item.title}`, level } })
        update(item.key, { state: 'done' })
      } catch (err) { update(item.key, { state: 'failed', error: errorMessage(err) }) }
    }
    setAdding(false)
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
        <><Button variant="outline" onClick={() => setItems(null)} disabled={adding}>Back</Button><Button onClick={add} loading={adding} disabled={!chosen}><Plus />{adding ? `Adding ${done + 1} of ${chosen}…` : `Write and add ${chosen} experiment${chosen === 1 ? '' : 's'}`}</Button></>
      )}>
      <div className="flex flex-col gap-5">
        {error && <Alert>{error}</Alert>}
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

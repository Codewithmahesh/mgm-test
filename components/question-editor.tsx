'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useGibberishCheck } from '@/components/gibberish-check'
import { Alert, Field, Input, Select, Textarea } from '@/components/ui/form'
import { Dialog } from '@/components/ui/overlay'
import { QuestionImageUpload } from '@/components/question-attachment'
import { letter, type DraftQuestion, type Sample } from '@/lib/api'
import { BLOOM_INFO, BLOOM_LEVELS } from '@/lib/bloom'
import { cn } from '@/lib/utils'

export function blankQuestion(type: DraftQuestion['type'] = 'mcq'): DraftQuestion {
  return {
    type, text: '', options: type === 'tf' ? ['True', 'False'] : type === 'mcq' ? ['', '', '', ''] : [], correctIndex: type === 'coding' ? null : 0,
    topic: '', bloom: null, set: '', explanation: '', title: '', inputFormat: '', outputFormat: '', constraints: '',
    samples: type === 'coding' ? [{ input: '', output: '', explanation: '' }] : [], points: null, language: '', starterCode: '', imageUrl: '',
  }
}

/** Client-side check mirroring the server's rules, so errors show before saving. */
export function validateQuestion(q: DraftQuestion): string | null {
  if (!q.text.trim()) return q.type === 'coding' ? 'Write the problem statement.' : 'Write the question.'
  if (q.type === 'coding') {
    if (!q.title.trim()) return 'Give the problem a title.'
    return null
  }
  const options = q.options.map(o => o.trim())
  if (options.filter(Boolean).length < 2 || options.some(o => !o)) return 'Fill in every option (at least two).'
  if (new Set(options.map(o => o.toLowerCase())).size !== options.length) return 'Options must be different from each other.'
  if (q.correctIndex == null || q.correctIndex < 0 || q.correctIndex >= options.length) return 'Choose the correct answer.'
  return null
}

export function QuestionEditor({ open, initial, onClose, onSave, title }: { open: boolean; initial: DraftQuestion | null; onClose: () => void; onSave: (question: DraftQuestion) => Promise<void> | void; title?: string }) {
  const [q, setQ] = useState<DraftQuestion>(initial ?? blankQuestion())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const checkText = useGibberishCheck()
  useEffect(() => { if (open) { setQ(initial ?? blankQuestion()); setError('') } }, [open, initial])

  const set = <K extends keyof DraftQuestion>(key: K, value: DraftQuestion[K]) => setQ(current => ({ ...current, [key]: value }))
  const setType = (type: DraftQuestion['type']) => setQ(current => ({ ...blankQuestion(type), text: current.text, topic: current.topic, bloom: current.bloom, set: current.set, explanation: current.explanation, imageUrl: current.imageUrl }))
  const setSample = (index: number, key: keyof Sample, value: string) => set('samples', q.samples.map((s, i) => (i === index ? { ...s, [key]: value } : s)))

  async function save() {
    const problem = validateQuestion(q)
    if (problem) return setError(problem)
    if (!(await checkText([
      ...(q.type === 'coding' ? [{ label: 'Title', value: q.title }] : []),
      { label: q.type === 'coding' ? 'Statement' : 'Question', value: q.text },
      ...(q.type === 'mcq' ? [{ label: 'Options', value: q.options.join(' ') }] : []),
      { label: 'Topic', value: q.topic },
    ]))) return
    setSaving(true)
    try { await onSave({ ...q, options: q.options.map(o => o.trim()) }); onClose() } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.') } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onClose={onClose} size="lg" title={title ?? (initial ? 'Edit question' : 'New question')}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>{saving ? 'Saving…' : 'Save question'}</Button></>}>
      <div className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <div className="inline-flex self-start rounded-md border border-border bg-muted p-0.5">
          {(['mcq', 'tf', 'coding'] as const).map(type => (
            <button key={type} type="button" onClick={() => setType(type)} className={cn('rounded px-3 py-1.5 text-[13px] font-medium', q.type === type ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}>
              {type === 'mcq' ? 'Multiple choice' : type === 'tf' ? 'True / False' : 'Coding problem'}
            </button>
          ))}
        </div>

        {q.type === 'coding' ? (
          <>
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <Field label="Problem title" required><Input value={q.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Pair Sum" /></Field>
              <Field label="Marks" hint="Blank = room default"><Input type="number" min={0} value={q.points ?? ''} onChange={e => set('points', e.target.value ? Number(e.target.value) : null)} /></Field>
            </div>
            <Field label="Problem statement" required><Textarea rows={5} value={q.text} onChange={e => set('text', e.target.value)} placeholder="Describe the task clearly…" /></Field>
            <QuestionImageUpload imageUrl={q.imageUrl} onChange={url => set('imageUrl', url)} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Input format"><Textarea rows={3} value={q.inputFormat} onChange={e => set('inputFormat', e.target.value)} placeholder="The first line contains N…" /></Field>
              <Field label="Output format"><Textarea rows={3} value={q.outputFormat} onChange={e => set('outputFormat', e.target.value)} placeholder="Print a single integer…" /></Field>
            </div>
            <Field label="Constraints"><Textarea rows={2} className="font-mono text-[13px]" value={q.constraints} onChange={e => set('constraints', e.target.value)} placeholder={'1 ≤ N ≤ 10^5\n1 ≤ A[i] ≤ 10^9'} /></Field>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <span className="text-[13px] font-medium">Test cases / Sample tests</span>
                  <span className="ml-2 text-xs text-muted-foreground">(Optional)</span>
                </div>
                <Button variant="ghost" size="xs" type="button" onClick={() => set('samples', [...q.samples, { input: '', output: '', explanation: '' }])}>
                  <Plus className="size-3.5" />Add test case
                </Button>
              </div>
              {q.samples.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-4 text-center">
                  <p className="text-xs text-muted-foreground">No test cases added yet.</p>
                  <Button variant="outline" size="xs" type="button" className="mt-2" onClick={() => set('samples', [{ input: '', output: '', explanation: '' }])}>
                    <Plus className="size-3.5" />Add first test case
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {q.samples.map((sample, index) => (
                    <div key={index} className="rounded-md border border-border p-3">
                      <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
                        <span>Test case {index + 1}</span>
                        <button type="button" onClick={() => set('samples', q.samples.filter((_, i) => i !== index))} aria-label="Remove test case" className="rounded p-1 hover:bg-muted hover:text-danger">
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Input" hint="stdin"><Textarea rows={3} className="font-mono text-[13px]" value={sample.input} onChange={e => setSample(index, 'input', e.target.value)} placeholder="Sample input" /></Field>
                        <Field label="Expected output" hint="stdout"><Textarea rows={3} className="font-mono text-[13px]" value={sample.output} onChange={e => setSample(index, 'output', e.target.value)} placeholder="Expected output" /></Field>
                      </div>
                      <Input className="mt-2" value={sample.explanation} onChange={e => setSample(index, 'explanation', e.target.value)} placeholder="Explanation (optional)" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <Field label="Question" required><Textarea rows={3} value={q.text} onChange={e => set('text', e.target.value)} placeholder="Type the question…" autoFocus /></Field>
            <QuestionImageUpload imageUrl={q.imageUrl} onChange={url => set('imageUrl', url)} />
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-medium">Options <span className="font-normal text-muted-foreground">— select the correct one</span></span>
                {q.type === 'mcq' && q.options.length < 6 && <Button variant="ghost" size="xs" type="button" onClick={() => set('options', [...q.options, ''])}><Plus />Add option</Button>}
              </div>
              <div className="flex flex-col gap-2">
                {q.options.map((option, index) => (
                  <div key={index} className={cn('flex items-center gap-2 rounded-md border p-1.5 pl-2.5', q.correctIndex === index ? 'border-success bg-success-soft/50' : 'border-border')}>
                    <input type="radio" name="correct" checked={q.correctIndex === index} onChange={() => set('correctIndex', index)} className="size-4 accent-[var(--success)]" aria-label={`Mark option ${letter(index)} correct`} />
                    <span className="w-4 font-mono text-xs font-semibold text-muted-foreground">{letter(index)}</span>
                    <Input value={option} disabled={q.type === 'tf'} onChange={e => set('options', q.options.map((o, i) => (i === index ? e.target.value : o)))} placeholder={`Option ${letter(index)}`} className="h-8 border-0 shadow-none focus:ring-0" />
                    {q.type === 'mcq' && q.options.length > 2 && <button type="button" onClick={() => { set('options', q.options.filter((_, i) => i !== index)); if ((q.correctIndex ?? 0) >= index && (q.correctIndex ?? 0) > 0) set('correctIndex', (q.correctIndex ?? 1) - 1) }} aria-label="Remove option" className="rounded p-1.5 text-subtle hover:bg-muted hover:text-danger"><Trash2 className="size-3.5" /></button>}
                  </div>
                ))}
              </div>
            </div>
            <Field label="Explanation" hint="Optional. Shown to students in their result review."><Textarea rows={2} value={q.explanation} onChange={e => set('explanation', e.target.value)} /></Field>
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_120px]">
          <Field label="Topic"><Input value={q.topic} onChange={e => set('topic', e.target.value)} placeholder="e.g. Linked lists" /></Field>
          <Field label="Bloom's level">
            <Select value={q.bloom ?? ''} onChange={e => set('bloom', (e.target.value || null) as DraftQuestion['bloom'])}>
              <option value="">Not set</option>
              {BLOOM_LEVELS.map(level => <option key={level} value={level}>L{BLOOM_INFO[level].n} · {BLOOM_INFO[level].label}</option>)}
            </Select>
          </Field>
          <Field label="Set" hint="Blank = every set."><Input value={q.set} maxLength={12} onChange={e => set('set', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="e.g. A" /></Field>
        </div>
      </div>
    </Dialog>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Download, FileText, FileUp, PenLine, Pencil, Plus, Search, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react'
import { QuestionCard } from '@/components/question-card'
import { QuestionEditor, blankQuestion } from '@/components/question-editor'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/card'
import { Alert, Field, Input, Select, Textarea } from '@/components/ui/form'
import { Dialog, useFeedback } from '@/components/ui/overlay'
import { api, errorMessage, type BankQuestion, type DraftQuestion } from '@/lib/api'
import { cn } from '@/lib/utils'

export type AddMethod = 'ai' | 'csv' | 'manual' | 'bank'

const CSV_TEMPLATE = [
  'question,optionA,optionB,optionC,optionD,answer,type,topic,difficulty',
  '"Which data structure uses FIFO order?",Stack,Queue,Tree,Graph,B,mcq,Queues,easy',
  '"A binary search runs in O(log n) time.",True,False,,,A,tf,Searching,easy',
  '"Reverse the given array and print it.",,,,,,coding,Arrays,easy',
].join('\n')

/**
 * Four ways to add questions — AI, CSV, manual, or copying from the bank — all ending in a
 * review list the teacher can edit before anything is saved.
 */
export function AddQuestions({ open, onClose, roomId, initialMethod = 'ai', defaults, onSaved }: {
  open: boolean
  onClose: () => void
  roomId?: string | null
  initialMethod?: AddMethod
  defaults?: { mcq: number; coding: number }
  onSaved: (count: number) => void
}) {
  const { toast } = useFeedback()
  const [method, setMethod] = useState<AddMethod>(initialMethod)
  const [drafts, setDrafts] = useState<DraftQuestion[]>([])
  const [source, setSource] = useState<'ai' | 'csv' | 'manual'>('manual')
  const [editing, setEditing] = useState<{ index: number | null; question: DraftQuestion } | null>(null)
  const [saving, setSaving] = useState(false)
  const [skipped, setSkipped] = useState<string[]>([])

  useEffect(() => { if (open) { setMethod(initialMethod); setDrafts([]); setSkipped([]) } }, [open, initialMethod])

  const reviewing = drafts.length > 0
  const receive = (questions: DraftQuestion[], from: 'ai' | 'csv' | 'manual', errors: string[] = []) => { setDrafts(list => [...list, ...questions]); setSource(from); setSkipped(errors) }

  async function saveDrafts() {
    setSaving(true)
    try {
      const data = await api<{ saved: number; errors: string[] }>('/api/questions', { body: { questions: drafts, room: roomId ?? null, source } })
      toast(`${data.saved} question${data.saved === 1 ? '' : 's'} added${roomId ? ' to the room' : ' to your bank'}.`)
      onSaved(data.saved)
      onClose()
    } catch (err) { toast(errorMessage(err), 'error') } finally { setSaving(false) }
  }

  const methods: { value: AddMethod; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
    { value: 'ai', label: 'Generate with AI', icon: Sparkles, hint: 'From a PDF, notes or a topic' },
    { value: 'csv', label: 'Upload CSV', icon: FileUp, hint: 'Import a spreadsheet' },
    { value: 'manual', label: 'Write manually', icon: PenLine, hint: 'MCQ or coding problem' },
    ...(roomId ? [{ value: 'bank' as const, label: 'From question bank', icon: BookOpen, hint: 'Reuse earlier questions' }] : []),
  ]

  const mcqs = drafts.filter(q => q.type !== 'coding').length
  return (
    <>
      <Dialog open={open && !editing} onClose={onClose} size="xl" title={reviewing ? `Review ${drafts.length} question${drafts.length === 1 ? '' : 's'}` : 'Add questions'}
        description={reviewing ? 'Edit or remove anything before saving. Nothing is saved until you confirm.' : roomId ? 'Questions go into this room\'s pool. Each student gets a random selection.' : 'Questions are saved to your question bank.'}
        footer={reviewing ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] text-muted-foreground">{mcqs} MCQ · {drafts.length - mcqs} coding</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing({ index: null, question: blankQuestion() })}><Plus />Add another</Button>
              <Button onClick={saveDrafts} disabled={saving}>{saving ? 'Saving…' : `Save ${drafts.length} question${drafts.length === 1 ? '' : 's'}`}</Button>
            </div>
          </div>
        ) : undefined}>
        {reviewing ? (
          <div>
            <button onClick={() => { setDrafts([]); setSkipped([]) }} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />Start over</button>
            {skipped.length > 0 && (
              <details className="mb-3 rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-[13px] text-warning-ink">
                <summary className="cursor-pointer font-medium">{skipped.length} row{skipped.length === 1 ? '' : 's'} skipped</summary>
                <ul className="mt-2 flex list-disc flex-col gap-0.5 pl-5 text-xs">{skipped.slice(0, 40).map(item => <li key={item}>{item}</li>)}</ul>
              </details>
            )}
            <div className="overflow-hidden rounded-lg border border-border">
              {drafts.map((question, index) => (
                <QuestionCard key={index} question={question} index={index} actions={<>
                  <button onClick={() => setEditing({ index, question })} aria-label="Edit" className="rounded p-1.5 text-subtle hover:bg-muted hover:text-foreground"><Pencil className="size-3.5" /></button>
                  <button onClick={() => setDrafts(list => list.filter((_, i) => i !== index))} aria-label="Remove" className="rounded p-1.5 text-subtle hover:bg-muted hover:text-danger"><Trash2 className="size-3.5" /></button>
                </>} />
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
            <nav className="flex gap-1 overflow-x-auto md:flex-col">
              {methods.map(item => (
                <button key={item.value} onClick={() => setMethod(item.value)} className={cn('flex shrink-0 items-start gap-3 rounded-md px-3 py-2.5 text-left', method === item.value ? 'bg-primary-soft text-primary' : 'hover:bg-muted')}>
                  <item.icon className="mt-0.5 size-4" />
                  <span><span className="block text-sm font-medium">{item.label}</span><span className={cn('hidden text-xs md:block', method === item.value ? 'text-primary/80' : 'text-muted-foreground')}>{item.hint}</span></span>
                </button>
              ))}
            </nav>
            <div className="min-w-0">
              {method === 'ai' && <AiGenerator defaults={defaults} onResult={questions => receive(questions, 'ai')} />}
              {method === 'csv' && <CsvImport onResult={(questions, errors) => receive(questions, 'csv', errors)} />}
              {method === 'manual' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {(['mcq', 'tf', 'coding'] as const).map(type => (
                    <button key={type} onClick={() => setEditing({ index: null, question: blankQuestion(type) })} className="rounded-lg border border-border p-4 text-left hover:border-primary hover:bg-primary-soft/40">
                      {type === 'coding' ? <FileText className="size-5 text-violet" /> : <PenLine className="size-5 text-primary" />}
                      <p className="mt-3 text-sm font-semibold">{type === 'mcq' ? 'Multiple choice' : type === 'tf' ? 'True / False' : 'Coding problem'}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{type === 'coding' ? 'Statement, formats, constraints and samples' : type === 'tf' ? 'A statement that is true or false' : 'Up to six options, one correct'}</p>
                    </button>
                  ))}
                </div>
              )}
              {method === 'bank' && roomId && <BankPicker roomId={roomId} onAdded={count => { toast(`${count} question${count === 1 ? '' : 's'} copied into the room.`); onSaved(count); onClose() }} />}
            </div>
          </div>
        )}
      </Dialog>
      <QuestionEditor open={Boolean(editing)} initial={editing?.question ?? null} title={editing?.index == null ? 'New question' : 'Edit question'} onClose={() => setEditing(null)}
        onSave={question => {
          if (editing?.index == null) { setDrafts(list => [...list, question]); if (!drafts.length) setSource('manual') }
          else setDrafts(list => list.map((q, i) => (i === editing.index ? question : q)))
        }} />
    </>
  )
}

function AiGenerator({ defaults, onResult }: { defaults?: { mcq: number; coding: number }; onResult: (questions: DraftQuestion[]) => void }) {
  const [mode, setMode] = useState<'pdf' | 'text' | 'topic'>('pdf')
  const [pdf, setPdf] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [topic, setTopic] = useState('')
  const [mcqCount, setMcqCount] = useState(String(Math.min(defaults?.mcq || 10, 60)))
  const [codingCount, setCodingCount] = useState(String(Math.min(defaults?.coding ?? 0, 10)))
  const [difficulty, setDifficulty] = useState('mixed')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  async function generate() {
    setError('')
    if (mode === 'pdf' && !pdf) return setError('Choose a PDF first.')
    if (mode === 'text' && text.trim().length < 50) return setError('Paste at least a paragraph of content.')
    if (mode === 'topic' && !topic.trim()) return setError('Enter a topic.')
    if (Number(mcqCount) + Number(codingCount) === 0) return setError('Ask for at least one question.')
    setLoading(true)
    try {
      const form = new FormData()
      form.append('topic', topic)
      form.append('mcqCount', mcqCount)
      form.append('codingCount', codingCount)
      form.append('difficulty', difficulty)
      if (mode === 'text') form.append('sourceText', text)
      if (mode === 'pdf' && pdf) form.append('pdf', pdf)
      const data = await api<{ questions: DraftQuestion[] }>('/api/generate-questions', { body: form })
      onResult(data.questions)
    } catch (err) { setError(errorMessage(err)) } finally { setLoading(false) }
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
      <Spinner className="size-7" />
      <p className="mt-4 text-sm font-medium">Generating {Number(mcqCount) + Number(codingCount)} questions…</p>
      <p className="mt-1 text-xs text-muted-foreground">This usually takes 10–40 seconds{mode === 'pdf' ? ' for a PDF' : ''}.</p>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      <div className="inline-flex self-start rounded-md border border-border bg-muted p-0.5">
        {([['pdf', 'Upload PDF'], ['text', 'Paste text'], ['topic', 'Topic only']] as const).map(([value, label]) => (
          <button key={value} onClick={() => setMode(value)} className={cn('rounded px-3 py-1.5 text-[13px] font-medium', mode === value ? 'bg-card shadow-xs' : 'text-muted-foreground hover:text-foreground')}>{label}</button>
        ))}
      </div>
      {mode === 'pdf' && (
        <button type="button" onClick={() => fileInput.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file?.type === 'application/pdf') setPdf(file) }}
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong bg-muted/40 px-4 py-8 text-center hover:border-primary hover:bg-primary-soft/40">
          <Upload className="size-5 text-primary" />
          <span className="mt-2 text-sm font-medium">{pdf ? pdf.name : 'Click or drop a PDF here'}</span>
          <span className="mt-0.5 text-xs text-muted-foreground">{pdf ? `${(pdf.size / 1024 / 1024).toFixed(1)} MB · click to replace` : 'Lecture notes, a chapter, a syllabus… up to 10 MB'}</span>
          <input ref={fileInput} type="file" accept="application/pdf" className="sr-only" onChange={e => { const file = e.target.files?.[0]; if (file) { if (file.size > 10 * 1024 * 1024) setError('That PDF is larger than 10 MB.'); else setPdf(file) } e.target.value = '' }} />
        </button>
      )}
      {mode === 'text' && <Field label="Content"><Textarea rows={7} value={text} onChange={e => setText(e.target.value)} placeholder="Paste lecture notes, a textbook section or a lesson plan…" /></Field>}
      <Field label={mode === 'topic' ? 'Topic' : 'Topic (optional)'} hint={mode === 'topic' ? 'Be specific, e.g. "Stacks and queues in C" rather than "Data structures".' : 'Helps focus the questions.'}>
        <Input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Binary search trees" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Number of MCQs"><Input type="number" min={0} max={60} value={mcqCount} onChange={e => setMcqCount(e.target.value)} /></Field>
        <Field label="Coding problems"><Input type="number" min={0} max={10} value={codingCount} onChange={e => setCodingCount(e.target.value)} /></Field>
        <Field label="Difficulty">
          <Select value={difficulty} onChange={e => setDifficulty(e.target.value)}><option value="mixed">Mixed</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></Select>
        </Field>
      </div>
      {defaults && defaults.mcq > 0 && Number(mcqCount) < defaults.mcq && <p className="text-xs text-muted-foreground">Tip: generate more than the {defaults.mcq} each student gets, so papers differ between students.</p>}
      <Button onClick={generate} size="lg" className="self-start"><Wand2 />Generate questions</Button>
    </div>
  )
}

function CsvImport({ onResult }: { onResult: (questions: DraftQuestion[], errors: string[]) => void }) {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  async function read(file: File) {
    setError('')
    if (file.size > 2 * 1024 * 1024) return setError('The file is larger than 2 MB.')
    setLoading(true)
    try {
      const data = await api<{ questions: DraftQuestion[]; errors: string[] }>('/api/questions/import', { body: { csv: await file.text() } })
      onResult(data.questions, data.errors)
    } catch (err) { setError(errorMessage(err)) } finally { setLoading(false) }
  }

  function template() {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'mgm-questions-template.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      <button type="button" disabled={loading} onClick={() => fileInput.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) read(file) }}
        className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong bg-muted/40 px-4 py-10 text-center hover:border-primary hover:bg-primary-soft/40">
        {loading ? <Spinner /> : <Upload className="size-5 text-primary" />}
        <span className="mt-2 text-sm font-medium">{loading ? 'Reading file…' : 'Click or drop a CSV file'}</span>
        <span className="mt-0.5 text-xs text-muted-foreground">You&apos;ll review every question before it&apos;s saved.</span>
        <input ref={fileInput} type="file" accept=".csv,text/csv" className="sr-only" onChange={e => { const file = e.target.files?.[0]; if (file) read(file); e.target.value = '' }} />
      </button>
      <div className="rounded-md border border-border p-4 text-[13px]">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium">Expected columns</p>
          <Button variant="outline" size="xs" onClick={template}><Download />Template</Button>
        </div>
        <p className="mt-2 font-mono text-xs text-muted-foreground">question, optionA, optionB, optionC, optionD, answer</p>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
          <li><span className="text-foreground">answer</span> can be a letter (B), a number (2) or the option&apos;s text.</li>
          <li>Optional: <span className="font-mono">type</span> (mcq / tf / coding), <span className="font-mono">topic</span>, <span className="font-mono">difficulty</span>, <span className="font-mono">explanation</span>.</li>
          <li>Coding rows: <span className="font-mono">title, inputFormat, outputFormat, constraints, sampleInput, sampleOutput, points</span>.</li>
        </ul>
      </div>
    </div>
  )
}

function BankPicker({ roomId, onAdded }: { roomId: string; onAdded: (count: number) => void }) {
  const [questions, setQuestions] = useState<BankQuestion[] | null>(null)
  const [query, setQuery] = useState('')
  const [type, setType] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: '100' })
      if (query.trim()) params.set('q', query.trim())
      if (type) params.set('type', type)
      api<{ questions: BankQuestion[] }>(`/api/questions?${params}`).then(data => setQuestions(data.questions.filter(q => q.room !== roomId))).catch(err => setError(errorMessage(err)))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, type, roomId])

  async function add() {
    setSaving(true)
    try { const data = await api<{ added: number }>(`/api/rooms/${roomId}`, { body: { questionIds: [...selected] } }); onAdded(data.added) } catch (err) { setError(errorMessage(err)) } finally { setSaving(false) }
  }
  const toggle = (id: string) => setSelected(set => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next })

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" /><Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search questions" className="pl-9" /></div>
        <Select value={type} onChange={e => setType(e.target.value)} className="w-36"><option value="">All types</option><option value="mcq">MCQ</option><option value="tf">True/False</option><option value="coding">Coding</option></Select>
      </div>
      <div className="max-h-[46vh] overflow-y-auto rounded-lg border border-border">
        {!questions ? <div className="flex justify-center py-10"><Spinner /></div> : questions.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No questions found in your bank.</p> :
          questions.map(question => <QuestionCard key={question.id} question={question} selectable={{ checked: selected.has(question.id), onChange: () => toggle(question.id) }} />)}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-muted-foreground">{selected.size} selected</span>
        <Button onClick={add} disabled={!selected.size || saving}>{saving ? 'Adding…' : `Copy ${selected.size || ''} into room`}</Button>
      </div>
    </div>
  )
}

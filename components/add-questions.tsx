'use client'

import Link from 'next/link'
import { useContext, useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Download, FileText, FileUp, Layers, PenLine, Pencil, Plus, Search, Sparkles, Mail, Trash2, Upload, Wand2, X } from 'lucide-react'
import { QuestionCard } from '@/components/question-card'
import { QuestionEditor, blankQuestion } from '@/components/question-editor'
import { QuestionAttachmentButton } from '@/components/question-attachment'
import { Button, buttonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/card'
import { Alert, Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form'
import { Dialog, useFeedback } from '@/components/ui/overlay'
import { BloomPlanEditor, draftCount, draftToPlan, emptyPlanDraft, planToDraft, type PlanDraft } from '@/components/bloom-plan'
import { api, errorMessage, type BankQuestion, type DraftQuestion } from '@/lib/api'
import { BLOOM_INFO, BLOOM_LEVELS, setNames, splitByShares, type BloomLevel, type BloomPlan } from '@/lib/bloom'
import { cn } from '@/lib/utils'
import { TeacherContext } from '@/components/role-context'
import { GenerationProgress, type GenerationRequest } from '@/components/generation-progress'
import { useGibberishCheck } from '@/components/gibberish-check'

export type AddMethod = 'ai' | 'csv' | 'manual' | 'bank'

/** What the AI was asked for, so the room's papers can be set up to match. */
export type GenerationPlan = { sets: string[]; mcqPerSet: number; codingPerSet: number; bloomPlan: BloomPlan | null; applyToRoom: boolean }

/** The room's current paper settings, used as the generator's starting values. */
export type GeneratorDefaults = { mcq: number; coding: number; marks?: number; bloomPlan?: BloomPlan; setCount?: number }

const CSV_TEMPLATE = [
  'question,optionA,optionB,optionC,optionD,answer,type,topic,bloom,set',
  '"Which data structure uses FIFO order?",Stack,Queue,Tree,Graph,B,mcq,Queues,remember,A',
  '"A binary search runs in O(log n) time.",True,False,,,A,tf,Searching,understand,B',
  '"Reverse the given array and print it.",,,,,,coding,Arrays,apply',
].join('\n')

/**
 * Four ways to add questions — AI, CSV, manual, or copying from the bank — all ending in a
 * review list the teacher can edit before anything is saved.
 */
export function AddQuestions({ open, onClose, roomId, initialMethod = 'ai', defaults, onSaved, reviewJobId = null }: {
  open: boolean
  onClose: () => void
  roomId?: string | null
  initialMethod?: AddMethod
  defaults?: GeneratorDefaults
  onSaved: (count: number) => void
  /** Open straight into reviewing the drafts of a finished AI generation. */
  reviewJobId?: string | null
}) {
  const { toast } = useFeedback()
  const teacher = useContext(TeacherContext)
  const [method, setMethod] = useState<AddMethod>(initialMethod)
  const [drafts, setDrafts] = useState<DraftQuestion[]>([])
  const [source, setSource] = useState<'ai' | 'csv' | 'manual'>('manual')
  const [editing, setEditing] = useState<{ index: number | null; question: DraftQuestion } | null>(null)
  const [saving, setSaving] = useState(false)
  const [skipped, setSkipped] = useState<string[]>([])
  const [plan, setPlan] = useState<GenerationPlan | null>(null)
  // The AI generation these drafts came from; marked as saved once they are.
  const [jobId, setJobId] = useState<string | null>(null)
  const [loadingReview, setLoadingReview] = useState(false)

  useEffect(() => {
    if (!open) return
    setMethod(initialMethod); setDrafts([]); setSkipped([]); setPlan(null); setJobId(null)
    if (!reviewJobId) return
    setLoadingReview(true)
    api<{ job: { status: string; error: string }; questions?: DraftQuestion[]; plan?: GenerationPlan }>(`/api/generation-jobs/${reviewJobId}`)
      .then(data => {
        if (!data.questions?.length) { toast(data.job.error || 'These questions are not ready yet.', 'error'); onClose(); return }
        setDrafts(data.questions.map(q => ({ ...q, set: q.set ?? '' }))); setSource('ai'); setPlan(data.plan ?? null); setJobId(reviewJobId)
      })
      .catch(err => { toast(errorMessage(err), 'error'); onClose() })
      .finally(() => setLoadingReview(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialMethod, reviewJobId])

  const reviewing = drafts.length > 0
  const receive = (questions: DraftQuestion[], from: 'ai' | 'csv' | 'manual', errors: string[] = []) => { setDrafts(list => [...list, ...questions]); setSource(from); setSkipped(errors) }

  async function saveDrafts() {
    setSaving(true)
    try {
      const data = await api<{ saved: number; errors: string[] }>('/api/questions', { body: { questions: drafts, room: roomId ?? null, source } })
      let applied = ''
      if (roomId && plan?.applyToRoom) {
        // Match the room's papers to what was generated: one set per student and/or the Bloom's level plan.
        try {
          await api(`/api/rooms/${roomId}`, { method: 'PATCH', body: {
            ...(plan.sets.length ? { paperMode: 'sets', setCount: plan.sets.length } : {}),
            questionsPerStudent: plan.mcqPerSet, codingQuestions: plan.codingPerSet,
            ...(plan.bloomPlan ? { bloomPlan: plan.bloomPlan } : {}),
          } })
          applied = plan.sets.length ? ` Each student now gets one of sets ${plan.sets.join(', ')}.` : " Every paper now uses this Bloom's level plan."
        } catch (err) { toast(`Questions saved, but the room settings were not updated: ${errorMessage(err)}`, 'error') }
      }
      if (jobId) await api(`/api/generation-jobs/${jobId}`, { method: 'PATCH', body: { action: 'saved' } }).catch(() => {})
      toast(`${data.saved} question${data.saved === 1 ? '' : 's'} added${roomId ? ' to the room' : ' to your bank'}.${applied}`)
      onSaved(data.saved)
      onClose()
    } catch (err) { toast(errorMessage(err), 'error') } finally { setSaving(false) }
  }

  const methods: { value: AddMethod; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
    { value: 'ai', label: 'Generate with AI', icon: Sparkles, hint: 'From PDFs, Word/LaTeX files, notes or a topic' },
    { value: 'csv', label: 'Upload CSV', icon: FileUp, hint: 'Import a spreadsheet' },
    { value: 'manual', label: 'Write manually', icon: PenLine, hint: 'MCQ or coding problem' },
    ...(roomId ? [{ value: 'bank' as const, label: 'From question bank', icon: BookOpen, hint: 'Reuse earlier questions' }] : []),
  ]

  const mcqs = drafts.filter(q => q.type !== 'coding').length
  const setNames = [...new Set(drafts.map(q => q.set).filter(Boolean))].sort()
  const setSummary = setNames.length ? setNames.map(name => `Set ${name}: ${drafts.filter(q => q.set === name).length}`).join(' · ') : ''
  return (
    <>
      <Dialog open={open && !editing} onClose={onClose} size="xl" title={reviewing ? `Review ${drafts.length} question${drafts.length === 1 ? '' : 's'}` : 'Add questions'}
        description={reviewing ? 'Edit or remove anything before saving. Nothing is saved until you confirm.' : roomId ? 'Questions go into this room\'s pool. Each student gets a random selection.' : 'Questions are saved to your question bank.'}
        footer={reviewing ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] text-muted-foreground">{mcqs} MCQ · {drafts.length - mcqs} coding{setSummary && ` · ${setSummary}`}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing({ index: null, question: blankQuestion() })}><Plus />Add another</Button>
              <Button onClick={saveDrafts} loading={saving}>{saving ? 'Saving…' : `Save ${drafts.length} question${drafts.length === 1 ? '' : 's'}`}</Button>
            </div>
          </div>
        ) : undefined}>
        {loadingReview ? (
          <div className="flex items-center justify-center py-16"><Spinner className="size-6" /></div>
        ) : reviewing ? (
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
                <div key={index}>
                {setNames.length > 0 && question.set !== drafts[index - 1]?.set && (
                  <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-2 text-xs font-semibold">
                    <Layers className="size-3.5 text-primary" />{question.set ? `Set ${question.set}` : 'Common to every set'}
                    <span className="font-normal text-muted-foreground">{levelSummary(drafts.filter(q => q.set === question.set))}</span>
                  </div>
                )}
                <QuestionCard question={question} index={index} actions={<>
                  <QuestionAttachmentButton
                    imageUrl={question.imageUrl}
                    onImageChange={(url) => setDrafts(list => list.map((q, i) => i === index ? { ...q, imageUrl: url } : q))}
                  />
                  <button onClick={() => setEditing({ index, question })} aria-label="Edit" className="rounded p-1.5 text-subtle hover:bg-muted hover:text-foreground"><Pencil className="size-3.5" /></button>
                  <button onClick={() => setDrafts(list => list.filter((_, i) => i !== index))} aria-label="Remove" className="rounded p-1.5 text-subtle hover:bg-muted hover:text-danger"><Trash2 className="size-3.5" /></button>
                </>} />
                </div>
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
              {method === 'ai' && <AiGenerator defaults={defaults} roomId={roomId ?? null}
                onResult={(questions, next, id) => { receive(questions, 'ai'); setPlan(next); setJobId(id) }}
                email={teacher?.email ?? 'your email'} onClose={onClose} />}
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

function levelSummary(questions: DraftQuestion[]) {
  const mcq = questions.filter(q => q.type !== 'coding')
  const parts = BLOOM_LEVELS.map(level => [level, mcq.filter(q => q.bloom === level).length] as const).filter(([, n]) => n > 0).map(([level, n]) => `L${BLOOM_INFO[level].n} ${BLOOM_INFO[level].label}: ${n}`)
  return parts.join(' · ')
}

type BloomMode = 'mixed' | 'custom' | BloomLevel

// Keep in sync with lib/source-files.ts.
const SOURCE_EXTENSIONS = ['.pdf', '.doc', '.docx', '.tex']
const MAX_FILES = 10
const MAX_FILES_BYTES = 4 * 1024 * 1024

// Keep in sync with lib/generation-jobs.ts.
const MAX_SETS = 20
const MAX_TOTAL_MCQ = 1000
const MAX_TOTAL_CODING = 100

function AiGenerator({ defaults, roomId, onResult, email, onClose }: {
  defaults?: GeneratorDefaults
  roomId: string | null
  onResult: (questions: DraftQuestion[], plan: GenerationPlan, jobId: string) => void
  email: string
  onClose: () => void
}) {
  const inRoom = Boolean(roomId)
  const { confirm } = useFeedback()
  const checkText = useGibberishCheck()
  const [mode, setMode] = useState<'pdf' | 'text' | 'topic'>('pdf')
  const [files, setFiles] = useState<File[]>([])
  const [text, setText] = useState('')
  const [topic, setTopic] = useState('')
  const [description, setDescription] = useState('')
  const [mcqCount, setMcqCount] = useState(String(Math.min(defaults?.mcq || 10, 120)))
  const [codingCount, setCodingCount] = useState(String(Math.min(defaults?.coding ?? 0, MAX_TOTAL_CODING)))
  const [bloomMode, setBloomMode] = useState<BloomMode>(defaults?.bloomPlan?.length ? 'custom' : 'mixed')
  const [draft, setDraft] = useState<PlanDraft>(() => defaults?.bloomPlan?.length ? planToDraft(defaults.bloomPlan, defaults.marks ?? 1) : emptyPlanDraft(defaults?.marks ?? 1))
  const [useSets, setUseSets] = useState((defaults?.setCount ?? 0) >= 2)
  const [setCountText, setSetCountText] = useState(String(defaults?.setCount && defaults.setCount >= 2 ? defaults.setCount : 3))
  const [applyToRoom, setApplyToRoom] = useState(true)
  const [starting, setStarting] = useState(false)
  // The running generation and what it was asked for (drives the progress screen).
  const [running, setRunning] = useState<{ jobId: string; request: GenerationRequest } | null>(null)
  // Handed to the server: nothing more to do here.
  const [inBackground, setInBackground] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const perSetMcq = Math.max(0, Math.round(Number(mcqCount) || 0))
  const perSetCoding = Math.max(0, Math.round(Number(codingCount) || 0))
  const sets = useSets ? Math.max(0, Math.round(Number(setCountText) || 0)) : 1
  const custom = bloomMode === 'custom'
  // Questions per set at each level: the custom plan (anything left over is spread across all levels), an even mix, or one level.
  const levels = custom
    ? (() => { const planned = BLOOM_LEVELS.map(level => Math.max(0, Math.round(Number(draft[level].count) || 0))); const extra = splitByShares(Math.max(0, perSetMcq - draftCount(draft))); return planned.map((n, i) => n + extra[i]) })()
    : bloomMode === 'mixed' ? splitByShares(perSetMcq) : BLOOM_LEVELS.map(level => (level === bloomMode ? perSetMcq : 0))
  const totalMcq = perSetMcq * Math.max(1, sets)
  const totalCoding = perSetCoding * Math.max(1, sets)
  const letters = setNames(sets)
  const canApply = inRoom && (useSets || custom)
  const filesSize = files.reduce((sum, file) => sum + file.size, 0)

  function addFiles(list: FileList | null) {
    if (!list) return
    setError('')
    const next = [...files]
    for (const file of Array.from(list)) {
      if (!SOURCE_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext))) { setError(`${file.name}: only PDF, Word (.doc, .docx) and LaTeX (.tex) files are supported.`); continue }
      if (next.some(f => f.name === file.name && f.size === file.size)) continue
      next.push(file)
    }
    if (next.length > MAX_FILES) return setError(`Upload at most ${MAX_FILES} files at a time.`)
    if (next.reduce((sum, file) => sum + file.size, 0) > MAX_FILES_BYTES) return setError('The files add up to more than 4 MB. Remove some or compress them first.')
    setFiles(next)
  }

  async function generate() {
    setError('')
    if (mode === 'pdf' && !files.length) return setError('Choose at least one file first.')
    if (mode === 'text' && text.trim().length < 50) return setError('Paste at least a paragraph of content.')
    if (mode === 'topic' && !topic.trim() && !description.trim()) return setError('Enter a topic or instructions.')
    if (perSetMcq + perSetCoding === 0) return setError('Ask for at least one question.')
    if (custom && draftCount(draft) > perSetMcq) return setError(`The Bloom levels add up to ${draftCount(draft)} questions but you asked for ${perSetMcq}. Increase the question count or lower a level.`)
    const assigned = custom ? draftCount(draft) : perSetMcq
    if (custom && assigned < perSetMcq && !(await confirm({
      title: 'Bloom plan has unassigned questions',
      description: <>Your plan assigns <b>{assigned}</b> of <b>{perSetMcq}</b> MCQs per set. The remaining <b>{perSetMcq - assigned}</b> will be balanced across Bloom&apos;s levels. Continue?</>,
      confirmLabel: 'Continue',
      cancelLabel: 'Review plan',
    }))) return
    if (useSets && (sets < 2 || sets > MAX_SETS)) return setError(`Choose between 2 and ${MAX_SETS} sets.`)
    if (totalMcq > MAX_TOTAL_MCQ) return setError(`That is ${totalMcq} MCQs in total; generate at most ${MAX_TOTAL_MCQ} at a time (fewer sets or fewer questions per set).`)
    if (totalCoding > MAX_TOTAL_CODING) return setError(`That is ${totalCoding} coding problems in total; generate at most ${MAX_TOTAL_CODING} at a time (fewer sets or fewer problems per set).`)
    if (!(await checkText([{ label: 'Topic', value: topic }, { label: 'Instructions', value: description }, ...(mode === 'text' ? [{ label: 'Pasted content', value: text }] : [])]))) return
    setStarting(true)
    try {
      // The server splits the request into parts and keeps it, so it can also finish in the background.
      const form = new FormData()
      form.append('topic', topic)
      form.append('description', description)
      form.append('codingCount', String(perSetCoding))
      form.append('sets', String(useSets ? sets : 1))
      if (bloomMode === 'mixed' || custom) {
        form.append('bloomMode', 'custom')
        BLOOM_LEVELS.forEach((level, i) => form.append(level, String(levels[i])))
      } else {
        form.append('bloomMode', bloomMode)
        form.append('mcqCount', String(perSetMcq))
      }
      if (mode === 'text') form.append('sourceText', text)
      if (mode === 'pdf') files.forEach(file => form.append('files', file))
      if (roomId) form.append('room', roomId)
      if (custom) form.append('bloomPlan', JSON.stringify(draftToPlan(draft)))
      form.append('applyToRoom', String(canApply && applyToRoom))
      const { job } = await api<{ job: { id: string } }>('/api/generation-jobs', { body: form })
      setRunning({
        jobId: job.id,
        request: {
          levels: levels.map(n => n * Math.max(1, sets)), coding: totalCoding, sets: useSets ? letters : [],
          sources: mode === 'pdf' ? files.map(f => f.name) : mode === 'text' ? ['your notes'] : [], topic: topic.trim() || description.trim(),
        },
      })
    } catch (err) { setError(errorMessage(err)) } finally { setStarting(false) }
  }

  if (inBackground) return (
    <div className="flex animate-float-in flex-col items-center px-4 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success"><Mail className="size-5" /></span>
      <p className="mt-4 text-base font-semibold">Generating in the background</p>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        <b className="font-semibold text-foreground">You can safely close this tab or window.</b> We&apos;re working on your questions on our side and will email <b className="font-semibold text-foreground">{email}</b> as soon as they&apos;re ready. Then review them and add them {roomId ? 'to the room' : 'to your question bank'}.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">You can also check progress any time under AI generations.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link href="/teacher/generations" className={buttonVariants({ variant: 'outline' })}><Sparkles />View AI generations</Link>
        <Button onClick={onClose}>Done</Button>
      </div>
    </div>
  )

  if (running) return (
    <GenerationProgress jobId={running.jobId} request={running.request}
      onReady={(questions, plan) => { setRunning(null); onResult(questions, plan, running.jobId) }}
      onBackground={() => { setRunning(null); setInBackground(true) }}
      onStop={message => { setRunning(null); setError(message) }} />
  )

  return (
    <div className="flex flex-col gap-5">
      {error && <Alert>{error}</Alert>}
      <div className="inline-flex self-start rounded-md border border-border bg-muted p-0.5">
        {([['pdf', 'Upload files'], ['text', 'Paste text'], ['topic', 'Topic only']] as const).map(([value, label]) => (
          <button key={value} onClick={() => setMode(value)} className={cn('rounded px-3 py-1.5 text-[13px] font-medium', mode === value ? 'bg-card shadow-xs' : 'text-muted-foreground hover:text-foreground')}>{label}</button>
        ))}
      </div>
      {mode === 'pdf' && (
        <div className="flex flex-col gap-2">
          <button type="button" onClick={() => fileInput.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
            className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong bg-muted/40 px-4 py-8 text-center hover:border-primary hover:bg-primary-soft/40">
            <Upload className="size-5 text-primary" />
            <span className="mt-2 text-sm font-medium">{files.length ? 'Click or drop to add more files' : 'Click or drop files here'}</span>
            <span className="mt-0.5 text-xs text-muted-foreground">{files.length ? `${files.length} file${files.length > 1 ? 's' : ''} · ${(filesSize / 1024 / 1024).toFixed(1)} of 4 MB` : 'PDF, Word (.doc, .docx) or LaTeX (.tex): lecture notes, chapters, a syllabus… up to 4 MB in total'}</span>
            <input ref={fileInput} type="file" multiple accept={SOURCE_EXTENSIONS.join(',')} className="sr-only" onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
          </button>
          {files.length > 0 && (
            <ul className="flex flex-col gap-1">
              {files.map((file, i) => (
                <li key={`${file.name}-${file.size}`} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                  <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {mode === 'text' && <Field label="Content"><Textarea rows={7} value={text} onChange={e => setText(e.target.value)} placeholder="Paste lecture notes, a textbook section or a lesson plan…" /></Field>}
      <Field label={mode === 'topic' ? 'Topic' : 'Topic (optional)'} hint={mode === 'topic' ? 'Be specific, e.g. "Stacks and queues in C" rather than "Data structures".' : 'Helps focus the questions.'}>
        <Input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Binary search trees" />
      </Field>
      <Field label="Instructions / Description for AI (optional)" hint="Tell the AI what faculty wants: specific question types, difficulty, focus areas, code language, or real-world problem scenarios.">
        <Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Include questions on edge cases and time complexities. Focus on pointer arithmetic and memory leaks. Avoid basic syntax definitions." />
      </Field>

      <section className="flex flex-col gap-3">
        <StepTitle n={1} title="How many questions" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={useSets ? 'MCQs in each set' : 'Number of MCQs'}><Input type="number" min={0} max={120} value={mcqCount} onChange={e => setMcqCount(e.target.value)} /></Field>
          <Field label={useSets ? 'Coding problems in each set' : 'Coding problems'}><Input type="number" min={0} max={MAX_TOTAL_CODING} value={codingCount} onChange={e => setCodingCount(e.target.value)} /></Field>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <StepTitle n={2} title="Bloom's taxonomy levels" />
        <Field label="Levels of the MCQs" className="sm:max-w-sm">
          <Select value={bloomMode} onChange={e => setBloomMode(e.target.value as BloomMode)}>
            <option value="mixed">Mixed across all six levels</option>
            <option value="custom">Set questions and marks per level</option>
            {BLOOM_LEVELS.map(level => <option key={level} value={level}>Only L{BLOOM_INFO[level].n} · {BLOOM_INFO[level].label}</option>)}
          </Select>
        </Field>
        {custom ? (
          <BloomPlanEditor total={perSetMcq} onTotalChange={total => setMcqCount(String(total))} draft={draft} onChange={setDraft}
            showMarks={inRoom} defaultMarks={defaults?.marks ?? 1} unit={useSets ? 'set' : 'paper'} />
        ) : perSetMcq > 0 && (
          <p className="text-xs text-muted-foreground">{useSets ? 'Each set' : 'The questions'}: {BLOOM_LEVELS.map((level, i) => (levels[i] ? `L${BLOOM_INFO[level].n} ${BLOOM_INFO[level].label} ${levels[i]}` : '')).filter(Boolean).join(' · ')}</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <StepTitle n={3} title="Question sets" />
        <Checkbox checked={useSets} onChange={e => setUseSets(e.target.checked)} label={<span>Create question sets <span className="text-muted-foreground">(Set A, Set B, … for different students)</span></span>} />
        {useSets && (
          <div className="flex flex-col gap-3 rounded-lg border border-primary-border bg-primary-soft/30 p-4 sm:flex-row sm:items-end sm:gap-5">
            <Field label="How many sets?" className="w-36"><Input type="number" min={2} max={MAX_SETS} value={setCountText} onChange={e => setSetCountText(e.target.value)} /></Field>
            <p className="text-[13px] leading-6 text-muted-foreground sm:pb-1.5">
              {sets >= 2 && sets <= MAX_SETS
                ? <>Sets <b className="font-semibold text-foreground">{letters.join(', ')}</b>, each with {perSetMcq} MCQs{perSetCoding ? ` + ${perSetCoding} coding` : ''} and the same Bloom&apos;s levels: <b className="font-semibold text-foreground">{totalMcq + totalCoding} questions</b> in total.</>
                : `Enter between 2 and ${MAX_SETS} sets.`}
            </p>
          </div>
        )}
      </section>

      {canApply && (
        <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-3">
          <Checkbox checked={applyToRoom} onChange={e => setApplyToRoom(e.target.checked)}
            label={<span className="text-[13px]">Use these for this room&apos;s papers: {[useSets && `each student gets one set (${letters.join(', ')}), revealed after submitting`, `${perSetMcq} MCQs${perSetCoding ? ` + ${perSetCoding} coding` : ''} per student`, custom && "the per-level questions and marks above"].filter(Boolean).join('; ')}.</span>} />
        </div>
      )}
      {totalMcq > 120 && <Alert>That is {totalMcq} MCQs in total; the AI can make at most 120 at a time. Use fewer sets or fewer questions per set.</Alert>}
      {defaults && defaults.mcq > 0 && !useSets && perSetMcq > 0 && perSetMcq <= defaults.mcq && <p className="text-xs text-muted-foreground">Tip: generate more than the {defaults.mcq} each student gets, or create sets, so papers differ between students.</p>}
      <Button onClick={generate} disabled={starting} size="lg" className="self-start">{starting ? <Spinner /> : <Wand2 />}{starting ? 'Starting…' : `Generate ${totalMcq + totalCoding || ''} questions`}</Button>
    </div>
  )
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return <p className="flex items-center gap-2 text-[13px] font-semibold"><span className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">{n}</span>{title}</p>
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
          <li>Optional: <span className="font-mono">type</span> (mcq / tf / coding), <span className="font-mono">topic</span>, <span className="font-mono">bloom</span> (1–6 or remember / understand / apply / analyze / evaluate / create), <span className="font-mono">set</span> (A, B… for question sets), <span className="font-mono">explanation</span>.</li>
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
        <Button onClick={add} disabled={!selected.size} loading={saving}>{saving ? 'Adding…' : `Copy ${selected.size || ''} into room`}</Button>
      </div>
    </div>
  )
}

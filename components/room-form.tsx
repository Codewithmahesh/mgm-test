'use client'

import { useEffect, useState } from 'react'
import { Clock3, Code2, Layers, ListChecks, Scale, Shuffle, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Alert, Field, Input, Select, Textarea } from '@/components/ui/form'
import { useFeedback } from '@/components/ui/overlay'
import { BloomPlanEditor, draftCount, draftToPlan, emptyPlanDraft, planToDraft, type PlanDraft } from '@/components/bloom-plan'
import { api, type Classroom, type Room } from '@/lib/api'
import { paperMarks, setNames } from '@/lib/bloom'
import { cn } from '@/lib/utils'

export type RoomFormValues = {
  title: string
  description: string
  instructions: string
  durationMinutes: string
  questionsPerStudent: string
  codingQuestions: string
  marksPerQuestion: string
  negativeMarks: string
  codingMarks: string
  startsAt: string
  showResults: Room['showResults']
  allowedClassrooms: string[]
  requireFullscreen: boolean
  blockCopyPaste: boolean
  maxViolations: string
  requireApproval: boolean
  paperMode: 'random' | 'sets'
  setCount: string
  bloomMode: 'auto' | 'plan'
  bloomPlan: PlanDraft
}

const DEFAULT_INSTRUCTIONS = [
  'Do not switch tabs or windows during the exam; every switch is recorded.',
  'Answers are saved automatically. You can move between questions freely.',
  'The exam submits itself when the timer reaches zero.',
  'Coding answers are reviewed and graded by your faculty after the exam.',
].join('\n')

export function emptyRoomValues(): RoomFormValues {
  return { title: '', description: '', instructions: DEFAULT_INSTRUCTIONS, durationMinutes: '60', questionsPerStudent: '20', codingQuestions: '0', marksPerQuestion: '1', negativeMarks: '0', codingMarks: '10', startsAt: '', showResults: 'after_end', allowedClassrooms: [], requireFullscreen: true, blockCopyPaste: true, maxViolations: '0', requireApproval: true, paperMode: 'random', setCount: '3', bloomMode: 'auto', bloomPlan: emptyPlanDraft() }
}

function toLocalInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function roomToValues(room: Room): RoomFormValues {
  return {
    title: room.title, description: room.description, instructions: room.instructions,
    durationMinutes: String(room.durationMinutes), questionsPerStudent: String(room.questionsPerStudent), codingQuestions: String(room.codingQuestions),
    marksPerQuestion: String(room.marksPerQuestion), negativeMarks: String(room.negativeMarks), codingMarks: String(room.codingMarks),
    startsAt: toLocalInput(room.startsAt), showResults: room.showResults, allowedClassrooms: room.allowedClassrooms,
    requireFullscreen: room.requireFullscreen, blockCopyPaste: room.blockCopyPaste, maxViolations: String(room.maxViolations), requireApproval: room.requireApproval,
    paperMode: room.paperMode, setCount: String(room.setCount || 3),
    bloomMode: room.bloomPlan.length ? 'plan' : 'auto', bloomPlan: planToDraft(room.bloomPlan, room.marksPerQuestion),
  }
}

export function valuesToPayload(values: RoomFormValues) {
  const { bloomMode, bloomPlan, ...rest } = values
  return {
    ...rest,
    durationMinutes: Number(values.durationMinutes), questionsPerStudent: Number(values.questionsPerStudent), codingQuestions: Number(values.codingQuestions),
    marksPerQuestion: Number(values.marksPerQuestion), negativeMarks: Number(values.negativeMarks), codingMarks: Number(values.codingMarks),
    maxViolations: Number(values.maxViolations) || 0,
    paperMode: values.paperMode,
    setCount: values.paperMode === 'sets' ? Number(values.setCount) || 0 : 0,
    bloomPlan: bloomMode === 'plan' ? draftToPlan(bloomPlan) : [],
    startsAt: values.startsAt ? new Date(values.startsAt).toISOString() : null,
  }
}

function Choice({ selected, onSelect, icon: Icon, title, text }: { selected: boolean; onSelect: () => void; icon: React.ComponentType<{ className?: string }>; title: string; text: string }) {
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected}
      className={cn('flex items-start gap-3 rounded-lg border p-3.5 text-left transition-colors', selected ? 'border-primary bg-primary-soft/50 ring-1 ring-primary' : 'border-border hover:border-border-strong hover:bg-muted/50')}>
      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}><Icon className="size-4" /></span>
      <span><span className="block text-sm font-medium">{title}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{text}</span></span>
    </button>
  )
}

export function RoomForm({ initial, submitLabel, onSubmit, pool }: { initial: RoomFormValues; submitLabel: string; onSubmit: (values: RoomFormValues) => Promise<void>; pool?: { mcq: number; coding: number } }) {
  const { confirm } = useFeedback()
  const [values, setValues] = useState(initial)
  const [accessMode, setAccessMode] = useState<'specific' | 'all'>(() => {
    if (initial.title && initial.allowedClassrooms.length === 0) return 'all'
    return 'specific'
  })
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { api<{ classrooms: Classroom[] }>('/api/classrooms').then(data => setClassrooms(data.classrooms)).catch(() => {}) }, [])

  const set = <K extends keyof RoomFormValues>(key: K, value: RoomFormValues[K]) => setValues(current => ({ ...current, [key]: value }))
  const text = (key: keyof RoomFormValues) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(key, event.target.value as never)

  const usePlan = values.bloomMode === 'plan'
  const mcq = Number(values.questionsPerStudent) || 0
  const coding = Number(values.codingQuestions) || 0
  const plan = usePlan ? draftToPlan(values.bloomPlan) : []
  const marks = paperMarks({ questionsPerStudent: mcq, marksPerQuestion: Number(values.marksPerQuestion) || 0, codingQuestions: coding, codingMarks: Number(values.codingMarks) || 0, bloomPlan: plan })
  const sets = values.paperMode === 'sets' ? Number(values.setCount) || 0 : 0
  const planOver = usePlan && draftCount(values.bloomPlan) > mcq

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (mcq + coding === 0) return setError('Each student needs at least one MCQ or coding problem.')
    if (planOver) return setError(`The Bloom levels add up to ${draftCount(values.bloomPlan)} questions but each student gets ${mcq}. Increase the question count or lower a level.`)
    if (values.paperMode === 'sets' && (sets < 2 || sets > 26)) return setError('Choose between 2 and 26 sets, or switch to random papers.')
    if (accessMode === 'specific' && values.allowedClassrooms.length === 0) {
      return setError('Please select at least one class for this exam, or choose "All Students (Open to All)".')
    }
    const assigned = usePlan ? draftCount(values.bloomPlan) : mcq
    if (usePlan && assigned < mcq && !(await confirm({
      title: 'Bloom plan has unassigned questions',
      description: <>Your plan assigns <b>{assigned}</b> of <b>{mcq}</b> MCQs. The remaining <b>{mcq - assigned}</b> will be balanced across Bloom&apos;s levels. Continue?</>,
      confirmLabel: 'Continue',
      cancelLabel: 'Review plan',
    }))) return
    setSaving(true)
    setError('')
    try {
      await onSubmit({
        ...values,
        allowedClassrooms: accessMode === 'all' ? [] : values.allowedClassrooms,
      })
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.') } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex flex-col gap-6">
        {error && <Alert>{error}</Alert>}
        <Card>
          <CardHeader title="Details" description="What students see before they start." />
          <div className="flex flex-col gap-4 p-5">
            <Field label="Exam name" required htmlFor="title"><Input id="title" required value={values.title} onChange={text('title')} placeholder="e.g. Data Structures — Mid-Semester Test" autoFocus /></Field>
            <Field label="Short description" htmlFor="description"><Input id="description" value={values.description} onChange={text('description')} placeholder="Units 1–3: arrays, linked lists, stacks and queues" /></Field>
            <Field label="Instructions" htmlFor="instructions" hint="One rule per line. Shown on the start screen."><Textarea id="instructions" rows={5} value={values.instructions} onChange={text('instructions')} /></Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Paper and timing" description="How many questions each student gets, and how they're marked." />
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <Field label="Duration (minutes)" required htmlFor="duration"><Input id="duration" type="number" min={1} max={600} required value={values.durationMinutes} onChange={text('durationMinutes')} /></Field>
            <Field label="MCQs per student" required htmlFor="mcq" hint={pool ? `${pool.mcq} in this room's pool` : undefined}><Input id="mcq" type="number" min={0} max={500} required value={values.questionsPerStudent} onChange={text('questionsPerStudent')} /></Field>
            <Field label="Coding problems per student" htmlFor="coding" hint={pool ? `${pool.coding} in this room's pool` : undefined}><Input id="coding" type="number" min={0} max={20} value={values.codingQuestions} onChange={text('codingQuestions')} /></Field>
            <Field label="Marks per MCQ" htmlFor="marks" hint={usePlan ? 'For questions not covered by the Bloom plan.' : undefined}><Input id="marks" type="number" min={0} step={0.25} value={values.marksPerQuestion} onChange={text('marksPerQuestion')} /></Field>
            <Field label="Negative marks per wrong MCQ" htmlFor="neg" hint="0 for no negative marking."><Input id="neg" type="number" min={0} step={0.25} value={values.negativeMarks} onChange={text('negativeMarks')} /></Field>
            <Field label="Marks per coding problem" htmlFor="cmarks" hint="Default; a problem can set its own."><Input id="cmarks" type="number" min={0} step={0.5} value={values.codingMarks} onChange={text('codingMarks')} /></Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="How each paper is made" description="Every student gets the same number of questions at each Bloom's level, so no one gets an easier or harder paper." />
          <div className="flex flex-col gap-5 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Choice selected={values.paperMode === 'random'} onSelect={() => set('paperMode', 'random')} icon={Shuffle} title="Random from the pool" text="Each student gets a different random paper drawn from all the room's questions." />
              <Choice selected={values.paperMode === 'sets'} onSelect={() => set('paperMode', 'sets')} icon={Layers} title="Question sets (A, B, C…)" text="You make a fixed number of sets; students get them in turn. Their set is revealed after they submit." />
            </div>
            {values.paperMode === 'sets' && (
              <div className="flex flex-col gap-3 rounded-lg border border-primary-border bg-primary-soft/30 p-4 sm:flex-row sm:items-end sm:gap-5">
                <Field label="How many sets?" required htmlFor="setCount" className="w-36"><Input id="setCount" type="number" min={2} max={26} required value={values.setCount} onChange={text('setCount')} /></Field>
                <p className="text-[13px] leading-6 text-muted-foreground sm:pb-1.5">
                  {sets >= 2 ? <>Sets <b className="font-semibold text-foreground">{setNames(sets).join(', ')}</b>, each with {mcq} MCQs{coding ? ` + ${coding} coding` : ''}. The pool needs {sets * mcq} MCQs{coding ? ` and ${sets * coding} coding problems` : ''} tagged by set, or generate them in sets with AI.</> : 'Enter 2 or more.'}
                </p>
              </div>
            )}
            <div>
              <p className="text-[13px] font-medium">Bloom&apos;s taxonomy levels (MCQs)</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <Choice selected={!usePlan} onSelect={() => set('bloomMode', 'auto')} icon={Scale} title="Balanced automatically" text="Every paper follows the pool's mix of levels, with the same counts for everyone and the same marks per MCQ." />
                <Choice selected={usePlan} onSelect={() => set('bloomMode', 'plan')} icon={ListChecks} title="Questions and marks per level" text="You choose how many questions of each level every student gets, and the marks for each level." />
              </div>
              {usePlan && (
                <div className="mt-3">
                  <BloomPlanEditor total={mcq} onTotalChange={total => set('questionsPerStudent', String(total))} draft={values.bloomPlan} onChange={draft => set('bloomPlan', draft)}
                    defaultMarks={Number(values.marksPerQuestion) || 0} unit={values.paperMode === 'sets' ? 'set' : 'paper'} />
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Proctoring" description="Every rule break is recorded and shown to you as flags on the student's result." />
          <div className="flex flex-col gap-4 p-5">
            <Toggle checked={values.requireApproval} onChange={value => set('requireApproval', value)} title="Waiting room — admit students yourself" text="Students request to join with the room code and wait until you admit them from the Participants tab (one by one or all at once)." />
            <Toggle checked={values.requireFullscreen} onChange={value => set('requireFullscreen', value)} title="Require fullscreen" text="Students must stay in fullscreen; leaving it pauses the exam screen and is flagged." />
            <Toggle checked={values.blockCopyPaste} onChange={value => set('blockCopyPaste', value)} title="Block copy, paste and right-click" text="Stops copying questions out and pasting answers in. Students can still move their own code inside the editor." />
            <Field label="Auto-submit after this many violations" htmlFor="maxViolations" hint="Tab switches, leaving fullscreen, pasting, developer-tool shortcuts and opening a second device each count. 0 = never auto-submit (flag only)." className="max-w-sm">
              <Input id="maxViolations" type="number" min={0} max={100} value={values.maxViolations} onChange={text('maxViolations')} />
            </Field>
            <p className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">Always on: one active device per student, tab-switch and focus tracking, IP logging, a watermark with the student&apos;s email, server-side timer, and randomised papers.</p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Access and results" />
          <div className="flex flex-col gap-5 p-5">
            <Field label="Start time" htmlFor="startsAt" hint="Optional. Students can't start before this, even if the room is open." className="max-w-xs">
              <Input id="startsAt" type="datetime-local" value={values.startsAt} onChange={text('startsAt')} />
            </Field>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[13px] font-medium">Who can take this exam</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Choose whether this exam is restricted to specific classes or open to all students.</p>
                </div>
              </div>

              {/* Access Mode Selector: Specific Classes FIRST, All Students SECOND */}
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setAccessMode('specific')}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3 text-left transition-all',
                    accessMode === 'specific'
                      ? 'border-primary bg-primary-soft ring-1 ring-primary'
                      : 'border-border hover:bg-muted/50'
                  )}
                >
                  <input
                    type="radio"
                    name="accessMode"
                    checked={accessMode === 'specific'}
                    onChange={() => setAccessMode('specific')}
                    className="size-4 accent-[var(--primary)]"
                  />
                  <div>
                    <div className="text-sm font-semibold">Specific Classes Only</div>
                    <div className="text-xs text-muted-foreground">Restrict to selected departments & divisions</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAccessMode('all')
                    set('allowedClassrooms', [])
                  }}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3 text-left transition-all',
                    accessMode === 'all'
                      ? 'border-primary bg-primary-soft ring-1 ring-primary'
                      : 'border-border hover:bg-muted/50'
                  )}
                >
                  <input
                    type="radio"
                    name="accessMode"
                    checked={accessMode === 'all'}
                    onChange={() => {
                      setAccessMode('all')
                      set('allowedClassrooms', [])
                    }}
                    className="size-4 accent-[var(--primary)]"
                  />
                  <div>
                    <div className="text-sm font-semibold">All Students (Open to All)</div>
                    <div className="text-xs text-muted-foreground">Any registered student with the room code can join</div>
                  </div>
                </button>
              </div>

              {/* Specific Classes Checkbox Section */}
              {accessMode === 'specific' && (
                <div className="mt-3 rounded-lg border border-border bg-card p-3 space-y-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border pb-2">
                    <span>{values.allowedClassrooms.length} of {classrooms.length} classes selected</span>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => set('allowedClassrooms', classrooms.map(c => c.id))}
                        className="font-medium text-primary hover:underline"
                      >
                        Select All
                      </button>
                      <span>·</span>
                      <button
                        type="button"
                        onClick={() => set('allowedClassrooms', [])}
                        className="font-medium hover:text-foreground"
                      >
                        Unselect All
                      </button>
                    </div>
                  </div>

                  {classrooms.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No classes created yet.</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {classrooms.map(classroom => {
                        const checked = values.allowedClassrooms.includes(classroom.id)
                        return (
                          <label key={classroom.id} className={cn('flex cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm', checked ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted/60')}>
                            <span className="flex items-center gap-2.5">
                              <input
                                type="checkbox"
                                className="size-4 accent-[var(--primary)]"
                                checked={checked}
                                onChange={() => set('allowedClassrooms', checked ? values.allowedClassrooms.filter(id => id !== classroom.id) : [...values.allowedClassrooms, classroom.id])}
                              />
                              <span className="font-medium">{classroom.label}</span>
                            </span>
                            <span className="text-xs text-muted-foreground">{classroom.students}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            <Field label="Show students their score" htmlFor="showResults" className="max-w-sm">
              <Select id="showResults" value={values.showResults} onChange={text('showResults')}>
                <option value="after_end">After the exam ends (recommended)</option>
                <option value="after_submit">Right after they submit</option>
                <option value="never">Don&apos;t show scores</option>
              </Select>
            </Field>
          </div>
        </Card>
      </div>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        <Card>
          <CardHeader title="Summary" />
          <dl className="flex flex-col gap-3 p-5 text-sm">
            <Row icon={Clock3} label="Duration" value={`${values.durationMinutes || 0} min`} />
            <Row icon={ListChecks} label="MCQs" value={usePlan ? `${mcq} · ${marks.mcq} marks` : `${mcq} × ${values.marksPerQuestion || 0}`} />
            <Row icon={Code2} label="Coding" value={`${coding} × ${values.codingMarks || 0}`} />
            <div className="my-1 border-t border-border" />
            {sets >= 2 && <Row icon={Layers} label="Sets" value={`${sets} (${setNames(sets)[0]}–${setNames(sets)[sets - 1]})`} />}
            <Row icon={Trophy} label="Total marks" value={<span className="text-base font-semibold">{marks.total}</span>} />
            {Number(values.negativeMarks) > 0 && <p className="text-xs text-warning">−{values.negativeMarks} for each wrong MCQ</p>}
          </dl>
          <div className="border-t border-border p-4">
            <Button type="submit" size="lg" disabled={saving} className="w-full">{saving ? 'Saving…' : submitLabel}</Button>
          </div>
        </Card>
      </aside>
    </form>
  )
}

function Toggle({ checked, onChange, title, text }: { checked: boolean; onChange: (value: boolean) => void; title: string; text: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span><span className="block text-[13px] font-medium">{title}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{text}</span></span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cn('relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors', checked ? 'bg-primary' : 'bg-border-strong')}>
        <span className={cn('inline-block size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
      </button>
    </label>
  )
}

function Row({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-2 text-muted-foreground"><Icon className="size-4" />{label}</dt><dd className="tabular-nums">{value}</dd></div>
}


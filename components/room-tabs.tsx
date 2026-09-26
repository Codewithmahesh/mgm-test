'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, CheckCircle2, ClipboardCheck, Clock3, Code2, Download, Eye, Layers, ListChecks, Pencil, Plus, Radio, Scale, Send, ShieldAlert, ShieldCheck, Shuffle, Trash2, Trophy, Users } from 'lucide-react'
import { AddQuestions, type AddMethod } from '@/components/add-questions'
import { CopyCode } from '@/components/common'
import { IntegrityCell } from '@/components/integrity'
import type { Flags, RiskLevel } from '@/lib/integrity'
import { PdfButtons } from '@/components/paper-view'
import { QuestionCard } from '@/components/question-card'
import { QuestionEditor } from '@/components/question-editor'
import { RoomForm, roomToValues, valuesToPayload } from '@/components/room-form'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge, Card, CardHeader, EmptyState, Progress, Spinner, StatCard } from '@/components/ui/card'
import { Alert, Checkbox } from '@/components/ui/form'
import { useFeedback } from '@/components/ui/overlay'
import { api, clock, downloadFile, errorMessage, formatDate, formatDuration, relativeTime, type BankQuestion, type Classroom, type DraftQuestion, type Room } from '@/lib/api'
import { fixedMix, poolProblems, setLabels } from '@/lib/paper-rules'
import { useLatestRequest } from '@/lib/use-latest'
import { cn } from '@/lib/utils'

export type AttemptRow = {
  id: string; rank: number | null; studentName: string; studentEmail: string; rollNumber: string; className: string
  status: 'in_progress' | 'submitted'; answered: number; totalQuestions: number; correctCount: number; wrongCount: number
  mcqScore: number; codingScore: number; codingPending: number; score: number; maxScore: number; tabSwitches: number; autoSubmitted: boolean
  autoSubmitReason: string; flags: Flags; violations: number; risk: RiskLevel; riskScore: number; ipCount: number
  startedAt: string; endsAt: string; submittedAt: string | null; lastSeenAt: string; timeTakenSeconds: number | null
}

/* ---------------- Overview ---------------- */

export function OverviewTab({ room, onGo }: { room: Room; onGo: (tab: 'questions' | 'participants' | 'leaderboard') => void }) {
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  useEffect(() => { if (room.allowedClassrooms.length) api<{ classrooms: Classroom[] }>('/api/classrooms').then(d => setClassrooms(d.classrooms)).catch(() => {}) }, [room.allowedClassrooms.length])
  const writing = room.joined - room.submitted
  const totalMarks = room.questionsPerStudent * room.marksPerQuestion + room.codingQuestions * room.codingMarks
  const mcqShort = room.questionsPerStudent > room.mcqPoolSize
  const codingShort = room.codingQuestions > room.codingPoolSize

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Joined" value={room.joined} icon={Users} />
        <StatCard label="Writing now" value={writing} icon={Radio} tone="green" hint={writing ? <button onClick={() => onGo('participants')} className="text-primary hover:underline">Watch live</button> : undefined} />
        <StatCard label="Submitted" value={room.submitted} icon={CheckCircle2} tone="violet" hint={room.averagePercent != null ? `Average ${room.averagePercent}%` : undefined} />
        <StatCard label="To grade" value={room.pendingReview} icon={ClipboardCheck} tone={room.pendingReview ? 'amber' : 'blue'} hint={room.pendingReview ? <button onClick={() => onGo('leaderboard')} className="text-primary hover:underline">Grade coding answers</button> : 'Coding answers awaiting marks'} />
      </div>

      {room.flagged > 0 && (
        <Alert tone="danger" className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span><b>{room.flagged} student{room.flagged === 1 ? '' : 's'} flagged</b> for possible cheating (tab switches, leaving fullscreen, pasting, a second device…). <button onClick={() => onGo('participants')} className="font-semibold underline">Review flags</button></span>
        </Alert>
      )}

      {(mcqShort || codingShort || room.poolSize === 0) && (
        <Alert tone="warning" className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {room.poolSize === 0 ? 'This room has no questions yet.' : <>The pool is smaller than one paper:{mcqShort && ` ${room.mcqPoolSize}/${room.questionsPerStudent} MCQs`}{codingShort && ` ${room.codingPoolSize}/${room.codingQuestions} coding problems`}.</>}{' '}
            <button onClick={() => onGo('questions')} className="font-semibold underline">Add questions</button> before opening the room.
          </span>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Share with students" description="Students sign in with their college email, then enter this code." />
          <div className="p-5">
            <div className="flex flex-wrap items-center gap-3">
              <CopyCode code={room.code} large />
              <span className="text-[13px] text-muted-foreground">at <span className="font-medium text-foreground">{typeof window !== 'undefined' ? window.location.host : ''}/student</span></span>
            </div>
            <ol className="mt-5 flex flex-col gap-2.5 text-[13px] text-muted-foreground">
              <li><span className="mr-2 font-mono text-xs text-primary">01</span>Student signs in (first time: activates with the OTP sent to their college email).</li>
              <li><span className="mr-2 font-mono text-xs text-primary">02</span>Enters the room code on their dashboard and reads the instructions.</li>
              <li><span className="mr-2 font-mono text-xs text-primary">03</span>Starts the test once the room is <span className="font-medium text-foreground">Live</span>. Their timer starts then.</li>
            </ol>
          </div>
        </Card>
        <Card>
          <CardHeader title="Exam settings" />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-5 text-[13px]">
            <Detail icon={Clock3} label="Duration" value={`${room.durationMinutes} minutes`} />
            <Detail icon={Trophy} label="Total marks" value={totalMarks} />
            <Detail icon={ListChecks} label="MCQs per student" value={`${room.questionsPerStudent} × ${room.marksPerQuestion}${room.negativeMarks ? ` (−${room.negativeMarks})` : ''}`} />
            <Detail icon={Code2} label="Coding per student" value={room.codingQuestions ? `${room.codingQuestions} × ${room.codingMarks}` : 'None'} />
            <Detail icon={room.paperMode === 'sets' ? Layers : Shuffle} label="Papers" value={room.paperMode === 'sets' ? 'One set per student' : 'Random from the pool'} />
            <Detail icon={Scale} label="Difficulty per paper" value={room.difficultyMix ? `${room.difficultyMix.easy} easy · ${room.difficultyMix.medium} medium · ${room.difficultyMix.hard} hard` : 'Balanced automatically'} />
            <Detail icon={Clock3} label="Starts" value={room.startsAt ? formatDate(room.startsAt, true) : 'When opened'} />
            <Detail icon={Eye} label="Scores shown" value={{ after_end: 'After exam ends', after_submit: 'After submitting', never: 'Never' }[room.showResults]} />
            <Detail icon={ShieldCheck} label="Proctoring" value={[room.requireFullscreen && 'Fullscreen', room.blockCopyPaste && 'No copy/paste', 'Single device'].filter(Boolean).join(' · ')} />
            <Detail icon={ShieldAlert} label="Auto-submit" value={room.maxViolations ? `After ${room.maxViolations} violations` : 'Off (flag only)'} />
            <div className="col-span-2">
              <dt className="text-muted-foreground">Open to</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">{room.allowedClassrooms.length ? room.allowedClassrooms.map(id => <Badge key={id}>{classrooms.find(c => c.id === id)?.label ?? '…'}</Badge>) : <span>Any activated student with the code</span>}</dd>
            </div>
          </dl>
        </Card>
      </div>
      {room.instructions && (
        <Card>
          <CardHeader title="Instructions" description="Shown on the student's start screen." />
          <ul className="flex list-disc flex-col gap-1.5 py-4 pl-10 pr-5 text-[13px] leading-6">{room.instructions.split('\n').filter(Boolean).map((line, i) => <li key={i}>{line}</li>)}</ul>
        </Card>
      )}
    </div>
  )
}

function Detail({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }) {
  return <div><dt className="flex items-center gap-1.5 text-muted-foreground"><Icon className="size-3.5" />{label}</dt><dd className="mt-1 font-medium tabular-nums">{value}</dd></div>
}

/* ---------------- Questions ---------------- */

export function QuestionsTab({ room, questions, onChanged, onRemoved, autoOpen }: { room: Room; questions: BankQuestion[]; onChanged: () => void; onRemoved?: (questionId: string) => void; autoOpen?: boolean }) {
  const { toast, confirm } = useFeedback()
  const [adding, setAdding] = useState<AddMethod | null>(autoOpen ? 'ai' : null)
  const [editing, setEditing] = useState<BankQuestion | null>(null)
  const mcqs = questions.filter(q => q.type !== 'coding')
  const coding = questions.filter(q => q.type === 'coding')

  async function remove(question: BankQuestion) {
    const ok = await confirm({ title: 'Remove from this room?', description: room.joined ? 'Students who already started keep their paper; new papers won\'t include it. It stays in your question bank.' : 'It stays in your question bank.', confirmLabel: 'Remove' })
    if (!ok) return
    onRemoved?.(question.id)
    try { await api(`/api/questions/${question.id}`, { method: 'PATCH', body: { room: null } }); toast('Question removed from the room.') } catch (err) { toast(errorMessage(err), 'error') }
    onChanged()
  }
  async function save(question: DraftQuestion) {
    if (!editing) return
    await api(`/api/questions/${editing.id}`, { method: 'PATCH', body: question })
    toast('Question updated.')
    onChanged()
  }

  const actions = (question: BankQuestion) => <>
    <button onClick={() => setEditing(question)} aria-label="Edit" className="rounded p-1.5 text-subtle hover:bg-muted hover:text-foreground"><Pencil className="size-3.5" /></button>
    <button onClick={() => remove(question)} aria-label="Remove from room" className="rounded p-1.5 text-subtle hover:bg-muted hover:text-danger"><Trash2 className="size-3.5" /></button>
  </>

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_auto] md:items-stretch">
        <PoolMeter label="MCQ pool" have={mcqs.length} need={room.questionsPerStudent} icon={ListChecks} />
        <PoolMeter label="Coding pool" have={coding.length} need={room.codingQuestions} icon={Code2} />
        <Card className="flex flex-col justify-center gap-2 p-4">
          <Button onClick={() => setAdding('ai')}><Plus />Add questions</Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setAdding('csv')}>CSV</Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setAdding('bank')}>Bank</Button>
          </div>
        </Card>
      </div>

      {questions.length > 0 && <PaperPlan room={room} questions={questions} />}

      {questions.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted-foreground">Download this room&apos;s full question pool as a printable paper.</p>
          <PdfButtons size="sm" questions={questions} meta={{ title: room.title, code: room.code, description: room.description, durationMinutes: room.durationMinutes, marksPerQuestion: room.marksPerQuestion, negativeMarks: room.negativeMarks, codingMarks: room.codingMarks }} />
        </div>
      )}

      {room.status === 'open' && room.joined > 0 && <Alert tone="info">Students are already writing. Edits apply to new papers and to grading of MCQs that are changed.</Alert>}

      {questions.length === 0 ? (
        <Card><EmptyState icon={BookOpen} title="No questions in this room yet" description="Generate them with AI from a PDF or notes, import a CSV, write your own, or copy from your question bank." action={<Button onClick={() => setAdding('ai')}><Plus />Add questions</Button>} /></Card>
      ) : (
        <>
          {mcqs.length > 0 && <Card><CardHeader title={`Multiple choice · ${mcqs.length}`} description={room.paperMode === 'sets' && setLabels(questions).length ? `Each student gets ${room.questionsPerStudent} from their set, in random order.` : `Each student gets ${Math.min(room.questionsPerStudent, mcqs.length)} of these in random order, with the same difficulty mix.`} /><div>{mcqs.map((q, i) => <QuestionCard key={q.id} question={q} index={i} actions={actions(q)} />)}</div></Card>}
          {coding.length > 0 && <Card><CardHeader title={`Coding problems · ${coding.length}`} description={`Each student gets ${Math.min(room.codingQuestions, coding.length)} of these.`} /><div>{coding.map((q, i) => <QuestionCard key={q.id} question={q} index={i} actions={actions(q)} />)}</div></Card>}
        </>
      )}

      <AddQuestions open={adding !== null} initialMethod={adding ?? 'ai'} onClose={() => setAdding(null)} roomId={room.id} defaults={{ mcq: room.questionsPerStudent, coding: room.codingQuestions }} onSaved={onChanged} />
      <QuestionEditor open={Boolean(editing)} initial={editing} onClose={() => setEditing(null)} onSave={save} />
    </div>
  )
}

const levelCounts = (questions: BankQuestion[]) => {
  const mcq = questions.filter(q => q.type !== 'coding')
  return { easy: mcq.filter(q => q.difficulty === 'easy').length, medium: mcq.filter(q => q.difficulty === 'medium').length, hard: mcq.filter(q => q.difficulty === 'hard').length, unrated: mcq.filter(q => !q.difficulty).length, total: mcq.length, coding: questions.length - mcq.length }
}

/** How papers are built from this pool, per-set / per-difficulty counts, and anything that would make papers unequal. */
function PaperPlan({ room, questions }: { room: Room; questions: BankQuestion[] }) {
  const labels = setLabels(questions)
  const sets = room.paperMode === 'sets'
  const mix = fixedMix(room)
  const problems = poolProblems(room, questions)
  const pool = levelCounts(questions)
  const common = questions.filter(q => !q.set)
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2">{sets ? <Layers className="size-4 text-primary" /> : <Shuffle className="size-4 text-primary" />}{sets ? 'One set per student' : 'Random paper per student'}</span>}
        description={mix
          ? `Every paper: ${mix.easy} easy · ${mix.medium} medium · ${mix.hard} hard MCQs${room.codingQuestions ? ` + ${room.codingQuestions} coding` : ''}.`
          : `Difficulty is balanced automatically: every student gets the same easy / medium / hard counts, in the pool's proportions.`}
        action={problems.length ? <Badge tone="amber">Not ready</Badge> : <Badge tone="green">Fair papers</Badge>}
      />
      <div className="flex flex-col gap-3 p-5 pt-4">
        {sets && labels.length === 0 && <Alert tone="info">No question has a set yet, so papers are drawn from the whole pool. Generate questions in sets with AI, or tag questions with a set (A, B…) when editing them.</Alert>}
        {sets && labels.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {labels.map(label => {
              const c = levelCounts([...questions.filter(q => q.set === label), ...common])
              return (
                <div key={label} className="rounded-lg border border-border px-3 py-2.5">
                  <p className="text-sm font-semibold">Set {label} <span className="font-normal text-muted-foreground">· {c.total} MCQ{c.coding ? ` · ${c.coding} coding` : ''}</span></p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{c.easy} easy · {c.medium} medium · {c.hard} hard{c.unrated ? ` · ${c.unrated} unrated` : ''}</p>
                </div>
              )
            })}
            {common.length > 0 && <p className="self-center text-xs text-muted-foreground">{common.length} question{common.length === 1 ? '' : 's'} without a set {common.length === 1 ? 'is' : 'are'} used in every set.</p>}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">Pool: {pool.easy} easy · {pool.medium} medium · {pool.hard} hard{pool.unrated ? ` · ${pool.unrated} without a difficulty` : ''} MCQs.</p>
        )}
        {problems.length > 0 && (
          <Alert tone="warning">
            <p className="font-medium">Papers can&apos;t be made equal yet:</p>
            <ul className="mt-1 list-disc pl-5">{problems.slice(0, 6).map(problem => <li key={problem}>{problem}</li>)}</ul>
          </Alert>
        )}
      </div>
    </Card>
  )
}

function PoolMeter({ label, have, need, icon: Icon }: { label: string; have: number; need: number; icon: React.ComponentType<{ className?: string }> }) {
  const ok = have >= need
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground"><Icon className="size-4" />{label}</span>
        {need > 0 && <Badge tone={ok ? 'green' : 'amber'}>{ok ? 'Ready' : `${need - have} more needed`}</Badge>}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{have}<span className="ml-1 text-sm font-normal text-muted-foreground">{need ? `· ${need} per student` : '· not used'}</span></p>
      {need > 0 && <Progress className="mt-3" value={(have / need) * 100} tone={ok ? 'green' : 'amber'} />}
    </Card>
  )
}

/* ---------------- Participants (live) ---------------- */

export function useAttempts(roomId: string, live: boolean) {
  const [rows, setRows] = useState<AttemptRow[] | null>(null)
  const [error, setError] = useState('')
  const latest = useLatestRequest()
  const load = useCallback(() => latest(api<{ attempts: AttemptRow[] }>(`/api/rooms/${roomId}/attempts`), d => { setRows(d.attempts); setError('') }).catch(err => setError(errorMessage(err))), [roomId, latest])
  useEffect(() => {
    load()
    if (!live) return
    const timer = window.setInterval(load, 10_000)
    return () => window.clearInterval(timer)
  }, [load, live])
  return { rows, error, reload: load }
}

export function ParticipantsTab({ room, onChanged }: { room: Room; onChanged: () => void }) {
  const { toast, confirm } = useFeedback()
  const { rows, error, reload } = useAttempts(room.id, room.status === 'open')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t) }, [])

  async function forceSubmit(row: AttemptRow) {
    if (!(await confirm({ title: `Submit ${row.studentName}'s exam now?`, description: 'Their current answers will be graded and they won\'t be able to continue.', confirmLabel: 'Submit now', tone: 'danger' }))) return
    try { await api(`/api/rooms/${room.id}/attempts/${row.id}`, { method: 'PATCH', body: { action: 'submit' } }); toast('Exam submitted.'); reload(); onChanged() } catch (err) { toast(errorMessage(err), 'error') }
  }

  if (error) return <Alert>{error}</Alert>
  if (!rows) return <div className="flex justify-center py-16"><Spinner /></div>
  const writing = rows.filter(r => r.status === 'in_progress')
  const flaggedCount = rows.filter(r => r.risk !== 'clean').length
  const riskRank: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2, clean: 3 }
  const ordered = [...writing.sort((a, b) => riskRank[a.risk] - riskRank[b.risk] || a.studentName.localeCompare(b.studentName)), ...rows.filter(r => r.status === 'submitted').sort((a, b) => riskRank[a.risk] - riskRank[b.risk])]
    .filter(r => !flaggedOnly || r.risk !== 'clean')

  return (
    <Card>
      <CardHeader title="Participants" description={room.status === 'open' ? `${writing.length} writing · ${rows.length - writing.length} submitted · refreshes every 10 seconds` : `${rows.length} participant${rows.length === 1 ? '' : 's'}`}
        action={<>
          {flaggedCount > 0 && <Checkbox label={<span className="text-[13px]">Flagged only ({flaggedCount})</span>} checked={flaggedOnly} onChange={e => setFlaggedOnly(e.target.checked)} />}
          {room.status === 'open' && <span className="flex items-center gap-2 text-xs font-medium text-success"><span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" /><span className="relative size-2 rounded-full bg-success" /></span>Live</span>}
        </>} />
      {rows.length === 0 ? <EmptyState icon={Users} title="No one has joined yet" description={room.status === 'open' ? `Share the code ${room.code} with your students.` : 'Open the room so students can join.'} /> : (
        <div className="overflow-x-auto">
          <table className="table-base min-w-[900px]">
            <thead><tr><th>Student</th><th>Status</th><th>Progress</th><th>Integrity</th><th>Time</th><th>Last active</th><th /></tr></thead>
            <tbody>
              {ordered.map(row => {
                const left = Math.round((new Date(row.endsAt).getTime() - now) / 1000)
                return (
                  <tr key={row.id} className={cn(row.risk === 'high' && 'bg-danger-soft/50', row.risk === 'medium' && 'bg-warning-soft/40')}>
                    <td><div className="font-medium">{row.studentName}</div><div className="text-xs text-muted-foreground">{[row.rollNumber && `Roll ${row.rollNumber}`, row.className].filter(Boolean).join(' · ') || row.studentEmail}</div></td>
                    <td><StatusBadge row={row} /></td>
                    <td className="w-44"><div className="flex items-center gap-2"><Progress value={(row.answered / Math.max(1, row.totalQuestions)) * 100} className="flex-1" /><span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{row.answered}/{row.totalQuestions}</span></div></td>
                    <td><IntegrityCell flags={row.flags} /></td>
                    <td className="font-mono text-xs tabular-nums">{row.status === 'in_progress' ? <span className={cn(left < 300 && 'text-danger')}>{clock(left)} left</span> : formatDuration(row.timeTakenSeconds)}</td>
                    <td className="text-xs text-muted-foreground">{relativeTime(row.lastSeenAt)}</td>
                    <td className="text-right"><div className="flex justify-end gap-1">
                      <Link href={`/teacher/rooms/${room.id}/attempts/${row.id}`} className={buttonVariants({ variant: 'ghost', size: 'xs' })}>View</Link>
                      {row.status === 'in_progress' && <Button variant="ghost" size="xs" className="text-danger" onClick={() => forceSubmit(row)}><Send />Submit</Button>}
                    </div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export function StatusBadge({ row }: { row: Pick<AttemptRow, 'status' | 'autoSubmitted' | 'autoSubmitReason'> }) {
  if (row.status === 'in_progress') return <Badge tone="green" dot>Writing</Badge>
  if (!row.autoSubmitted) return <Badge tone="violet">Submitted</Badge>
  if (row.autoSubmitReason === 'violations') return <Badge tone="red">Auto-submitted: violations</Badge>
  if (row.autoSubmitReason === 'faculty') return <Badge tone="amber">Submitted by faculty</Badge>
  if (row.autoSubmitReason === 'room_closed') return <Badge tone="amber">Exam ended</Badge>
  return <Badge tone="amber">Time up</Badge>
}

export function TabSwitchBadge({ count }: { count: number }) {
  if (!count) return <span className="text-xs text-muted-foreground">0</span>
  return <Badge tone={count >= 3 ? 'red' : 'amber'}>{count} switch{count === 1 ? '' : 'es'}</Badge>
}

/* ---------------- Leaderboard ---------------- */

export function LeaderboardTab({ room }: { room: Room }) {
  const { rows, error } = useAttempts(room.id, room.status === 'open')
  const [pendingOnly, setPendingOnly] = useState(false)
  const shown = useMemo(() => (rows ?? []).filter(r => r.status === 'submitted' && (!pendingOnly || r.codingPending > 0)), [rows, pendingOnly])

  if (error) return <Alert>{error}</Alert>
  if (!rows) return <div className="flex justify-center py-16"><Spinner /></div>
  const submitted = rows.filter(r => r.status === 'submitted')
  const top = submitted[0]
  const avg = submitted.length ? submitted.reduce((sum, r) => sum + (r.maxScore ? r.score / r.maxScore : 0), 0) / submitted.length : null
  const pending = submitted.filter(r => r.codingPending > 0).length

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Top score" value={top ? `${top.score} / ${top.maxScore}` : '—'} icon={Trophy} tone="amber" hint={top?.studentName} />
        <StatCard label="Class average" value={avg == null ? '—' : `${Math.round(avg * 100)}%`} icon={Users} hint={`${submitted.length} submitted`} />
        <StatCard label="Awaiting grading" value={pending} icon={ClipboardCheck} tone={pending ? 'violet' : 'blue'} hint="Papers with ungraded coding answers" />
      </div>
      <Card>
        <CardHeader title="Leaderboard" description="Ranked by total score, then by time taken."
          action={<>
            {pending > 0 && <Checkbox label={<span className="text-[13px]">Needs grading only</span>} checked={pendingOnly} onChange={e => setPendingOnly(e.target.checked)} />}
            <Button variant="outline" size="sm" onClick={() => downloadFile(`/api/rooms/${room.id}/attempts?format=csv`)} disabled={!submitted.length}><Download />Export Excel</Button>
          </>} />
        {shown.length === 0 ? <EmptyState icon={Trophy} title={submitted.length ? 'Nothing to grade' : 'No submissions yet'} description={submitted.length ? 'All coding answers have marks.' : 'Scores appear here as students submit.'} /> : (
          <div className="overflow-x-auto">
            <table className="table-base min-w-[900px]">
              <thead><tr><th className="w-14">Rank</th><th>Student</th><th>MCQ</th><th>Coding</th><th>Total</th><th>Time</th><th>Integrity</th><th /></tr></thead>
              <tbody>
                {shown.map(row => (
                  <tr key={row.id} className={cn(row.risk === 'high' && 'bg-danger-soft/50')}>
                    <td><RankBadge rank={row.rank} /></td>
                    <td><div className="font-medium">{row.studentName}</div><div className="text-xs text-muted-foreground">{[row.rollNumber && `Roll ${row.rollNumber}`, row.className].filter(Boolean).join(' · ') || row.studentEmail}</div></td>
                    <td className="tabular-nums"><div>{row.mcqScore}</div><div className="text-xs text-muted-foreground"><span className="text-success">{row.correctCount}✓</span> <span className="text-danger">{row.wrongCount}✗</span></div></td>
                    <td className="tabular-nums">{row.codingScore}{row.codingPending > 0 && <div><Badge tone="violet">{row.codingPending} to grade</Badge></div>}</td>
                    <td className="tabular-nums"><span className="font-semibold">{row.score}</span><span className="text-muted-foreground"> / {row.maxScore}</span><div className="text-xs text-muted-foreground">{row.maxScore ? Math.round((row.score / row.maxScore) * 100) : 0}%</div></td>
                    <td className="text-xs tabular-nums text-muted-foreground">{formatDuration(row.timeTakenSeconds)}</td>
                    <td><IntegrityCell flags={row.flags} />{row.autoSubmitReason === 'violations' && <div className="mt-1 text-[11px] font-medium text-danger">Auto-submitted for violations</div>}</td>
                    <td className="text-right"><Link href={`/teacher/rooms/${room.id}/attempts/${row.id}`} className={buttonVariants({ variant: row.codingPending ? 'default' : 'outline', size: 'xs' })}>{row.codingPending ? 'Grade' : 'Review'}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function RankBadge({ rank }: { rank: number | null }) {
  if (!rank) return <span className="text-muted-foreground">—</span>
  const medal = rank === 1 ? 'bg-[#fde68a] text-[#78350f]' : rank === 2 ? 'bg-[#e5e7eb] text-[#374151]' : rank === 3 ? 'bg-[#fed7aa] text-[#7c2d12]' : 'bg-muted text-muted-foreground'
  return <span className={cn('inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums', medal)}>{rank}</span>
}

/* ---------------- Settings ---------------- */

export function SettingsTab({ room, onSaved, onDeleted }: { room: Room; onSaved: (room: Room) => void; onDeleted: () => void }) {
  const { toast, confirm } = useFeedback()
  async function remove() {
    const ok = await confirm({ title: `Delete "${room.title}"?`, description: `This permanently deletes the room and all ${room.joined} student result${room.joined === 1 ? '' : 's'}. Its questions stay in your question bank.`, confirmLabel: 'Delete room', tone: 'danger' })
    if (!ok) return
    try { await api(`/api/rooms/${room.id}`, { method: 'DELETE' }); toast('Room deleted.'); onDeleted() } catch (err) { toast(errorMessage(err), 'error') }
  }
  return (
    <div className="flex flex-col gap-6">
      <RoomForm initial={roomToValues(room)} submitLabel="Save changes" pool={{ mcq: room.mcqPoolSize, coding: room.codingPoolSize }}
        onSubmit={async values => {
          const data = await api<{ room: Room }>(`/api/rooms/${room.id}`, { method: 'PATCH', body: valuesToPayload(values) })
          toast('Settings saved.')
          onSaved(data.room)
        }} />
      <Card className="border-danger-border lg:mr-[324px]">
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div><h3 className="text-sm font-semibold text-danger">Delete this room</h3><p className="mt-0.5 text-[13px] text-muted-foreground">Removes the room and every student&apos;s result. This can&apos;t be undone.</p></div>
          <Button variant="destructive-outline" onClick={remove}><Trash2 />Delete room</Button>
        </div>
      </Card>
    </div>
  )
}

'use client'

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Bookmark, BookmarkCheck, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleX, Clock3, CloudOff, Code2, Copy, Eraser, LayoutGrid, Loader2, Maximize, MonitorX, Play, RotateCcw, Send, ShieldAlert, Sliders, Terminal, X } from 'lucide-react'
import { COLLEGE_NAME, Emblem } from '@/components/brand'
import { CodeEditor } from '@/components/code-editor'
import { RunCodeButton } from '@/components/compiler-panel'
import { allowClipboardText, exitExamFullscreen, useProctoring, type ProctoringConfig } from '@/components/use-proctoring'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/card'
import { Select } from '@/components/ui/form'
import { Dialog, useFeedback } from '@/components/ui/overlay'
import { ApiError, LANGUAGE_OPTIONS, STARTER_CODE, api, clock, errorMessage, letter, type Sample } from '@/lib/api'
import { INTEGRITY_EVENTS, type IntegrityEvent } from '@/lib/integrity'
import { cn } from '@/lib/utils'

type McqQuestion = { number: number; type: 'mcq' | 'tf'; text: string; imageUrl?: string; options: string[]; topic: string; marks?: number }
type CodingQuestion = { number: number; type: 'coding'; title: string; text: string; imageUrl?: string; topic: string; inputFormat: string; outputFormat: string; constraints: string; samples: Sample[]; points: number; language: string; starterCode: string }
type Question = McqQuestion | CodingQuestion
type CodeAnswer = { language: string; code: string; passedCases?: number; totalCases?: number; marks?: number }
type Answer = number | CodeAnswer | string | null

type Paper = {
  id: string
  status: 'in_progress' | 'submitted'
  student: { name: string; email: string; rollNumber: string }
  room: { title: string; code: string; marksPerQuestion: number; negativeMarks: number }
  proctoring: ProctoringConfig & { violations: number }
  serverNow: string
  startedAt: string
  endsAt: string
  questions?: Question[]
  answers?: Answer[]
  flagged?: number[]
}

type Heartbeat = { status: 'in_progress' | 'submitted'; endsAt: string; serverNow: string; autoSubmitReason: string; violations: number; maxViolations: number }

const isAnswered = (answer: Answer | undefined) => typeof answer === 'number' || (typeof answer === 'string' ? answer.trim() !== '' : Boolean(answer && typeof answer === 'object' && answer.code.trim()))
const asCode = (answer: Answer | undefined): CodeAnswer | null => (answer && typeof answer === 'object' ? { language: answer.language, code: answer.code, passedCases: answer.passedCases, totalCases: answer.totalCases, marks: answer.marks } : typeof answer === 'string' && answer ? { language: '', code: answer } : null)
const validLanguage = (value: string) => LANGUAGE_OPTIONS.some(option => option.value === value)

/** A random id for this browser tab. It survives a refresh (sessionStorage) but not a new tab or device. */
function tabId(attemptId: string) {
  const key = `examly-tab-${attemptId}`
  try {
    const existing = sessionStorage.getItem(key)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    sessionStorage.setItem(key, fresh)
    return fresh
  } catch {
    return ''
  }
}

export default function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [paper, setPaper] = useState<Paper | null>(null)
  const [loadError, setLoadError] = useState('')
  const [answers, setAnswers] = useState<Answer[]>([])
  const [flagged, setFlagged] = useState<number[]>([])
  const [current, setCurrent] = useState(0)
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]))
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'offline' | 'error'>('saved')
  const [finishOpen, setFinishOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [sessionLost, setSessionLost] = useState(false)
  const [ready, setReady] = useState(false)
  const [drawer, setDrawer] = useState(false)

  const pending = useRef<Record<number, Answer>>({})
  const saveTimer = useRef<number | undefined>(undefined)
  const clockOffset = useRef(0)
  const submitted = useRef(false)
  const sessionKey = useRef('')
  const endsAtRef = useRef<number | null>(null)

  const headers = () => ({ 'x-exam-session': sessionKey.current })
  const finish = useCallback(() => { submitted.current = true; exitExamFullscreen(); router.replace(`/student/results/${id}`) }, [id, router])

  // Handles the two "stop writing" answers from the server: already submitted, or opened elsewhere.
  const handleConflict = useCallback((error: unknown) => {
    if (!(error instanceof ApiError) || error.status !== 409) return false
    if (error.code === 'session_taken') { setSessionLost(true); return true }
    finish()
    return true
  }, [finish])

  const claim = useCallback(async () => {
    const data = await api<{ sessionKey: string }>(`/api/student/attempts/${id}/session`, { body: { tabId: tabId(id) } })
    sessionKey.current = data.sessionKey
    setSessionLost(false)
  }, [id])

  // Load the paper and claim the session once per page load (React may run effects twice in development).
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    api<Paper>(`/api/student/attempts/${id}`)
      .then(async data => {
        if (data.status === 'submitted') { finish(); return }
        clockOffset.current = new Date(data.serverNow).getTime() - Date.now()
        await claim()
        setPaper(data)
        endsAtRef.current = new Date(data.endsAt).getTime()
        setEndsAt(endsAtRef.current)
        setAnswers(data.answers ?? [])
        setFlagged(data.flagged ?? [])
        setReady(true)
      })
      .catch(err => { if (!handleConflict(err)) setLoadError(errorMessage(err)) })
  }, [id, finish, claim, handleConflict])

  const questions = useMemo(() => paper?.questions ?? [], [paper])

  const flush = useCallback(async (extra: { flagged?: number[] } = {}) => {
    if (submitted.current) return
    const batch = pending.current
    pending.current = {}
    if (!Object.keys(batch).length && !extra.flagged) return
    setSaveState('saving')
    try {
      await api(`/api/student/attempts/${id}`, { method: 'PATCH', body: { answers: batch, ...extra }, headers: headers() })
      setSaveState(Object.keys(pending.current).length ? 'saving' : 'saved')
    } catch (err) {
      if (handleConflict(err)) { pending.current = { ...batch, ...pending.current }; return }
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        // The server rejected this batch (not a network problem); retrying won't help.
        setSaveState('error')
        return
      }
      pending.current = { ...batch, ...pending.current }
      setSaveState('offline')
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => void flush(), 4000)
    }
  }, [id, handleConflict])

  const submit = useCallback(async () => {
    if (submitted.current) return
    submitted.current = true
    setSubmitting(true)
    setSubmitError('')
    window.clearTimeout(saveTimer.current)
    try {
      await api(`/api/student/attempts/${id}/submit`, { body: { answers: pending.current }, headers: headers() })
      pending.current = {}
      exitExamFullscreen()
      router.replace(`/student/results/${id}`)
    } catch (err) {
      submitted.current = false
      setSubmitting(false)
      if (err instanceof ApiError && err.code === 'session_taken') { setFinishOpen(false); setSessionLost(true); return }
      setSubmitError(`${errorMessage(err)} Check your connection and try again.`)
      setFinishOpen(true)
    }
  }, [id, router])

  const applyHeartbeat = useCallback((beat: Heartbeat) => {
    clockOffset.current = new Date(beat.serverNow).getTime() - Date.now()
    endsAtRef.current = new Date(beat.endsAt).getTime()
    setEndsAt(endsAtRef.current)
    if (beat.status === 'submitted') finish()
  }, [finish])

  const beat = useCallback(async () => {
    try { applyHeartbeat(await api<Heartbeat>(`/api/student/attempts/${id}/event`, { body: { type: 'heartbeat' }, headers: headers() })) } catch (err) {
      if (err instanceof ApiError && err.status === 404) { submitted.current = true; setLoadError('This exam was removed by your faculty.') }
      else handleConflict(err)
    }
  }, [id, applyHeartbeat, handleConflict])

  // Countdown against the server clock. At zero, check with the server first: the faculty may have added time.
  useEffect(() => {
    if (!ready || endsAt === null) return
    let checking = false
    const tick = async () => {
      const left = Math.max(0, Math.round((endsAt - (Date.now() + clockOffset.current)) / 1000))
      setSecondsLeft(left)
      if (left === 0 && !checking && !submitted.current) {
        checking = true
        await beat()
        // If the end time didn't move, time really is up.
        if (endsAtRef.current === endsAt) void submit()
      }
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [ready, endsAt, beat, submit])

  // Heartbeat every 30 s: keeps "last active" fresh and picks up time extensions or an early end.
  useEffect(() => {
    if (!ready) return
    const timer = window.setInterval(() => { if (!submitted.current && !sessionLost) void beat() }, 30_000)
    return () => window.clearInterval(timer)
  }, [ready, sessionLost, beat])

  // Save pending answers if the tab is closed.
  useEffect(() => {
    if (!ready) return
    const onLeave = () => {
      if (!Object.keys(pending.current).length || submitted.current) return
      fetch(`/api/student/attempts/${id}`, { method: 'PATCH', keepalive: true, headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify({ answers: pending.current }) })
      pending.current = {}
    }
    const onHidden = () => { if (document.visibilityState === 'hidden') void flush() }
    window.addEventListener('pagehide', onLeave)
    document.addEventListener('visibilitychange', onHidden)
    return () => { window.removeEventListener('pagehide', onLeave); document.removeEventListener('visibilitychange', onHidden) }
  }, [ready, id, flush])

  const report = useCallback(async (type: IntegrityEvent, detail?: string) => {
    if (submitted.current) return null
    try {
      const result = await api<Heartbeat>(`/api/student/attempts/${id}/event`, { body: { type, detail }, headers: headers() })
      applyHeartbeat(result)
      return { violations: result.violations, maxViolations: result.maxViolations }
    } catch (err) { handleConflict(err); return null }
  }, [id, applyHeartbeat, handleConflict])

  const proctoring = useProctoring({ enabled: ready && !sessionLost, config: paper?.proctoring ?? null, report })

  useEffect(() => { setVisited(set => (set.has(current) ? set : new Set(set).add(current))) }, [current])

  function setAnswer(index: number, value: Answer, delay: number) {
    setAnswers(list => { const next = [...list]; next[index] = value; return next })
    pending.current[index + 1] = value
    setSaveState('saving')
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void flush(), delay)
  }
  function toggleFlag(number: number) {
    const next = flagged.includes(number) ? flagged.filter(n => n !== number) : [...flagged, number]
    setFlagged(next)
    void flush({ flagged: next })
  }
  const go = (index: number) => { setCurrent(Math.max(0, Math.min(questions.length - 1, index))); setDrawer(false) }

  if (loadError) return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md text-center"><AlertTriangle className="mx-auto size-8 text-warning" /><h1 className="mt-4 text-xl font-medium">We couldn&apos;t open your exam</h1><p className="mt-2 text-sm text-muted-foreground">{loadError}</p><a href="/student" className="mt-6 inline-block text-sm font-medium text-primary">Back to dashboard</a></div>
    </div>
  )
  if (!paper || !questions.length) return <div className="flex min-h-screen items-center justify-center bg-background"><Spinner className="size-6" /></div>

  const question = questions[current]
  const answeredCount = answers.filter(isAnswered).length
  const time = secondsLeft ?? 0
  const mcqIndexes = questions.map((q, i) => (q.type === 'coding' ? -1 : i)).filter(i => i >= 0)
  const codingIndexes = questions.map((q, i) => (q.type === 'coding' ? i : -1)).filter(i => i >= 0)
  const blocked = sessionLost || proctoring.fullscreenNeeded
  const watermark = `${paper.student.email} · ${paper.student.rollNumber ? `Roll ${paper.student.rollNumber} · ` : ''}${paper.room.code}`

  const navigator = (
    <QuestionNavigator questions={questions} answers={answers} flagged={flagged} visited={visited} current={current} onGo={go} mcqIndexes={mcqIndexes} codingIndexes={codingIndexes} answeredCount={answeredCount} />
  )

  return (
    <div className={cn('flex h-dvh flex-col overflow-hidden bg-background', paper.proctoring.blockCopyPaste && 'select-none [&_.monaco-editor]:select-text [&_[data-code-editor]]:select-text')}>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-navy-2 bg-navy px-3 text-white sm:px-4">
        <Emblem size={34} />
        <span className="hidden text-[13px] font-semibold leading-tight text-white/90 xl:block">{COLLEGE_NAME}<span className="block text-[11px] font-normal text-white/45">Online examination</span></span>
        <div className="hidden h-6 w-px bg-white/15 sm:block" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{paper.room.title}</p>
          <p className="truncate text-[11px] text-white/50">{paper.student.name}{paper.student.rollNumber && ` · Roll ${paper.student.rollNumber}`}</p>
        </div>
        <span className="hidden items-center gap-1.5 rounded-md bg-white/5 px-2 py-1 text-[11px] text-white/60 lg:flex" title="This exam is proctored"><ShieldAlert className="size-3.5 text-brand" />Proctored</span>
        <SaveIndicator state={saveState} />
        <div role="timer" aria-label="Time remaining" className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-mono text-sm font-semibold tabular-nums', time <= 60 ? 'animate-pulse bg-danger text-white' : time <= 300 ? 'bg-danger/20 text-[#fca5a5]' : 'bg-white/10 text-brand')}>
          <Clock3 className="size-4" />{clock(time)}
        </div>
        <button onClick={() => setDrawer(true)} className="rounded-md p-2 text-white/80 hover:bg-white/10 lg:hidden" aria-label="Show questions"><LayoutGrid className="size-5" /></button>
        <Button onClick={() => { void flush(); setSubmitError(''); setFinishOpen(true) }} size="sm" className="bg-primary text-primary-foreground hover:bg-primary-hover"><Send />Finish<span className="hidden sm:inline"> test</span></Button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <aside className="hidden w-[272px] shrink-0 overflow-y-auto border-r border-border bg-card lg:block">{navigator}</aside>

        <main className="min-w-0 flex-1 overflow-hidden">
          {question.type === 'coding' ? (
            <CodingView key={question.number} question={question} answer={asCode(answers[current])} onChange={value => setAnswer(current, value, 1200)}
              flagged={flagged.includes(question.number)} onFlag={() => toggleFlag(question.number)}
              onPrev={current > 0 ? () => go(current - 1) : undefined} onNext={current < questions.length - 1 ? () => go(current + 1) : undefined} position={`${current + 1} / ${questions.length}`} />
          ) : (
            <McqView question={question} total={questions.length} selected={typeof answers[current] === 'number' ? (answers[current] as number) : null}
              marks={question.marks ?? paper.room.marksPerQuestion} negative={paper.room.negativeMarks} flagged={flagged.includes(question.number)}
              onSelect={option => setAnswer(current, option, 150)} onClear={() => setAnswer(current, null, 150)} onFlag={() => toggleFlag(question.number)}
              onPrev={current > 0 ? () => go(current - 1) : undefined}
              onNext={() => (current < questions.length - 1 ? go(current + 1) : setFinishOpen(true))}
              onFlagNext={() => { if (!flagged.includes(question.number)) toggleFlag(question.number); if (current < questions.length - 1) go(current + 1) }}
              isLast={current === questions.length - 1} keyboard={!finishOpen && !blocked && !proctoring.violation} />
          )}
        </main>

        {/* Faint watermark with the student's identity discourages photographing and sharing the paper. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-hidden opacity-[0.045]">
          <div className="absolute -inset-1/2 flex rotate-[-24deg] flex-wrap content-start gap-x-24 gap-y-20">
            {Array.from({ length: 80 }, (_, i) => <span key={i} className="whitespace-nowrap font-mono text-sm font-semibold text-foreground">{watermark}</span>)}
          </div>
        </div>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-40 flex lg:hidden" role="dialog" aria-label="Questions">
          <div className="absolute inset-0 bg-navy/40" onClick={() => setDrawer(false)} />
          <div className="relative ml-auto h-full w-[300px] max-w-[85vw] overflow-y-auto bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3"><span className="text-sm font-semibold">Questions</span><button onClick={() => setDrawer(false)} aria-label="Close" className="rounded p-1 hover:bg-muted"><X className="size-4" /></button></div>
            {navigator}
          </div>
        </div>
      )}

      {blocked && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-navy/95 p-6 text-white backdrop-blur" role="alertdialog" aria-modal="true">
          {sessionLost ? (
            <div className="max-w-md text-center">
              <MonitorX className="mx-auto size-10 text-brand" />
              <h2 className="mt-4 text-xl font-semibold">This exam is open somewhere else</h2>
              <p className="mt-2 text-sm leading-6 text-white/70">Your exam was opened in another tab, window or device, so this one was paused. This has been recorded and is visible to your faculty. Your timer is still running.</p>
              <Button className="mt-6 bg-primary text-primary-foreground hover:bg-primary-hover" onClick={() => claim().catch(err => { if (!handleConflict(err)) setLoadError(errorMessage(err)) })}>Continue on this device</Button>
            </div>
          ) : (
            <div className="max-w-md text-center">
              <Maximize className="mx-auto size-10 text-brand" />
              <h2 className="mt-4 text-xl font-semibold">Fullscreen is required</h2>
              <p className="mt-2 text-sm leading-6 text-white/70">This exam must be taken in fullscreen. Leaving fullscreen is recorded as a violation, and the Escape key is disabled while you write. Your timer keeps running while this screen is shown.</p>
              <p className="mt-4 font-mono text-2xl font-semibold text-brand">{clock(time)}</p>
              <Button className="mt-6 bg-primary text-primary-foreground hover:bg-primary-hover" onClick={proctoring.enterFullscreen}><Maximize />Enter fullscreen</Button>
            </div>
          )}
        </div>
      )}

      {proctoring.escapeNotice && !blocked && (
        <div role="status" className="fixed left-1/2 top-16 z-[65] flex -translate-x-1/2 items-center gap-2.5 rounded-lg bg-danger px-4 py-2.5 text-sm font-medium text-white shadow-xl animate-in fade-in slide-in-from-top-2">
          <ShieldAlert className="size-4" />Escape is disabled during the exam. Holding it will exit fullscreen and be recorded.
        </div>
      )}

      <Dialog open={finishOpen} onClose={() => !submitting && setFinishOpen(false)} dismissible={!submitting} title="Submit your exam?" description="You won't be able to change your answers after this."
        footer={<><Button variant="outline" onClick={() => setFinishOpen(false)} disabled={submitting}>Keep working</Button><Button onClick={submit} disabled={submitting}>{submitting ? <><Loader2 className="animate-spin" />Submitting…</> : 'Submit exam'}</Button></>}>
        {submitError && <p role="alert" className="mb-4 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger-ink">{submitError}</p>}
        <div className="grid grid-cols-3 gap-3 text-center">
          <SummaryTile label="Answered" value={answeredCount} tone="text-success" />
          <SummaryTile label="Not answered" value={questions.length - answeredCount} tone={questions.length - answeredCount ? 'text-danger' : 'text-muted-foreground'} />
          <SummaryTile label="Marked for review" value={flagged.length} tone="text-warning" />
        </div>
        {questions.length - answeredCount > 0 && (
          <div className="mt-4">
            <p className="text-[13px] text-muted-foreground">Unanswered — tap to go back:</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {questions.map((q, i) => (isAnswered(answers[i]) ? null : <button key={q.number} onClick={() => { setFinishOpen(false); go(i) }} className="flex h-8 min-w-8 items-center justify-center rounded-md border border-border px-2 font-mono text-xs hover:border-primary hover:text-primary">{q.type === 'coding' ? `P${codingIndexes.indexOf(i) + 1}` : mcqIndexes.indexOf(i) + 1}</button>))}
            </div>
          </div>
        )}
        <p className="mt-4 flex items-center gap-2 text-[13px] text-muted-foreground"><Clock3 className="size-4" />{clock(time)} remaining</p>
      </Dialog>

      <Dialog open={Boolean(proctoring.violation) && !blocked} onClose={proctoring.dismissViolation} size="sm" title="Warning: exam rule broken"
        footer={<Button onClick={proctoring.dismissViolation}>I understand, return to exam</Button>}>
        {proctoring.violation && (
          <div className="flex gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-danger" />
            <div className="text-sm leading-6">
              <p className="font-semibold">{INTEGRITY_EVENTS[proctoring.violation.type].label}</p>
              <p className="text-muted-foreground">{INTEGRITY_EVENTS[proctoring.violation.type].help} This has been recorded and is visible to your faculty.</p>
              {proctoring.violation.maxViolations > 0 && (
                <p className={cn('mt-3 rounded-md px-3 py-2 font-medium', proctoring.violation.maxViolations - proctoring.violation.violations <= 1 ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning')}>
                  Violations: {proctoring.violation.violations} of {proctoring.violation.maxViolations}. At {proctoring.violation.maxViolations} your exam is submitted automatically.
                </p>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}

function SaveIndicator({ state }: { state: 'saved' | 'saving' | 'offline' | 'error' }) {
  return (
    <span className={cn('hidden items-center gap-1.5 text-xs md:flex', state === 'offline' || state === 'error' ? 'text-[#fca5a5]' : 'text-white/55')}>
      {state === 'saving' ? <><Loader2 className="size-3.5 animate-spin" />Saving…</> : state === 'offline' ? <><CloudOff className="size-3.5" />Offline — retrying</> : state === 'error' ? <><AlertTriangle className="size-3.5" />Last change not saved</> : <><Check className="size-3.5" />All changes saved</>}
    </span>
  )
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className="rounded-lg border border-border p-3"><p className={cn('text-2xl font-semibold tabular-nums', tone)}>{value}</p><p className="mt-0.5 text-xs text-muted-foreground">{label}</p></div>
}

function QuestionNavigator({ questions, answers, flagged, visited, current, onGo, mcqIndexes, codingIndexes, answeredCount }: {
  questions: Question[]; answers: Answer[]; flagged: number[]; visited: Set<number>; current: number; onGo: (index: number) => void; mcqIndexes: number[]; codingIndexes: number[]; answeredCount: number
}) {
  const state = (index: number) => {
    const answered = isAnswered(answers[index])
    const review = flagged.includes(questions[index].number)
    return { answered, review, seen: visited.has(index) }
  }
  const cell = (index: number, label: React.ReactNode) => {
    const s = state(index)
    return (
      <button key={index} onClick={() => onGo(index)} aria-current={current === index ? 'step' : undefined} aria-label={`Question ${index + 1}${s.answered ? ', answered' : ''}${s.review ? ', marked for review' : ''}`}
        className={cn('relative flex h-9 items-center justify-center rounded-md border text-xs font-semibold tabular-nums transition-colors',
          s.answered ? 'border-success bg-success text-white' : s.seen ? 'border-danger-border bg-danger-soft text-danger' : 'border-border bg-card text-muted-foreground hover:border-border-strong',
          current === index && 'ring-2 ring-primary ring-offset-1')}>
        {label}
        {s.review && <span className="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-card bg-brand" />}
      </button>
    )
  }
  const percent = Math.round((answeredCount / questions.length) * 100)
  return (
    <div className="p-4">
      <div className="flex items-baseline justify-between"><p className="text-[13px] font-semibold">Progress</p><p className="text-xs tabular-nums text-muted-foreground">{answeredCount}/{questions.length} answered</p></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-success transition-all" style={{ width: `${percent}%` }} /></div>

      {mcqIndexes.length > 0 && <>
        <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-subtle">Multiple choice · {mcqIndexes.length}</p>
        <div className="grid grid-cols-5 gap-1.5">{mcqIndexes.map((index, i) => cell(index, i + 1))}</div>
      </>}
      {codingIndexes.length > 0 && <>
        <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-subtle">Coding · {codingIndexes.length}</p>
        <div className="flex flex-col gap-1.5">
          {codingIndexes.map((index, i) => {
            const q = questions[index] as CodingQuestion
            const s = state(index)
            return (
              <button key={index} onClick={() => onGo(index)} className={cn('flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left text-[13px]', current === index ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted')}>
                <span className={cn('flex size-6 shrink-0 items-center justify-center rounded font-mono text-[11px] font-semibold', s.answered ? 'bg-success text-white' : 'bg-muted text-muted-foreground')}>P{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{q.title}</span>
                {s.review && <Bookmark className="size-3.5 shrink-0 fill-brand text-brand" />}
              </button>
            )
          })}
        </div>
      </>}

      <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-success" />Answered</span>
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm border border-danger-border bg-danger-soft" />Not answered</span>
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm border border-border bg-card" />Not visited</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-brand" />For review</span>
      </div>
    </div>
  )
}

function McqView({ question, total, selected, marks, negative, flagged, onSelect, onClear, onFlag, onPrev, onNext, onFlagNext, isLast, keyboard }: {
  question: McqQuestion; total: number; selected: number | null; marks: number; negative: number; flagged: boolean
  onSelect: (index: number) => void; onClear: () => void; onFlag: () => void; onPrev?: () => void; onNext: () => void; onFlagNext: () => void; isLast: boolean; keyboard: boolean
}) {
  // Keyboard: A–F or 1–6 to choose, ←/→ to move.
  useEffect(() => {
    if (!keyboard) return
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      const byLetter = 'abcdef'.indexOf(key)
      const byNumber = '123456'.indexOf(key)
      const choice = byLetter >= 0 ? byLetter : byNumber
      if (choice >= 0 && choice < question.options.length) onSelect(choice)
      else if (event.key === 'ArrowRight' && !isLast) onNext()
      else if (event.key === 'ArrowLeft') onPrev?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [question, onSelect, onNext, onPrev, isLast, keyboard])

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-navy px-2.5 py-1 font-mono text-xs font-semibold text-white">Q{question.number}</span>
              <span className="text-[13px] text-muted-foreground">of {total}</span>
              {question.topic && <span className="hidden text-[13px] text-muted-foreground sm:inline">· {question.topic}</span>}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground"><span className="font-semibold text-success">+{marks}</span>{negative > 0 && <> / <span className="font-semibold text-danger">−{negative}</span></>}</span>
              <button onClick={onFlag} className={cn('flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium', flagged ? 'border-brand bg-warning-soft text-warning' : 'border-border text-muted-foreground hover:text-foreground')}>
                {flagged ? <BookmarkCheck className="size-3.5" /> : <Bookmark className="size-3.5" />}{flagged ? 'Marked for review' : 'Mark for review'}
              </button>
            </div>
          </div>
          <h2 className="mt-6 whitespace-pre-wrap text-[17px] font-medium leading-8 text-foreground">{question.text}</h2>
          {question.imageUrl && (
            <div className="mt-4 max-w-2xl overflow-hidden rounded-lg border border-border bg-card p-1 shadow-xs">
              <img
                src={question.imageUrl}
                alt={`Question ${question.number} diagram`}
                className="max-h-80 w-auto max-w-full rounded object-contain"
              />
            </div>
          )}
          <div role="radiogroup" className="mt-6 flex flex-col gap-2.5">
            {question.options.map((option, index) => {
              const active = selected === index
              return (
                <button key={index} role="radio" aria-checked={active} onClick={() => onSelect(index)}
                  className={cn('group flex items-start gap-3.5 rounded-lg border bg-card px-4 py-3.5 text-left transition-colors', active ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'border-border hover:border-border-strong hover:bg-muted/50')}>
                  <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-semibold', active ? 'border-primary bg-primary text-white' : 'border-border-strong text-muted-foreground group-hover:border-foreground/40')}>{letter(index)}</span>
                  <span className="pt-0.5 text-[15px] leading-6">{option}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-5 hidden text-xs text-subtle sm:block">Tip: press <span className="kbd">A</span>–<span className="kbd">{letter(question.options.length - 1)}</span> to choose, <span className="kbd">←</span> <span className="kbd">→</span> to move.</p>
        </div>
      </div>
      <div className="shrink-0 border-t border-border bg-card">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-8">
          <div className="flex gap-2">
            <Button variant="outline" onClick={onPrev} disabled={!onPrev}><ChevronLeft />Previous</Button>
            <Button variant="ghost" onClick={onClear} disabled={selected === null}><Eraser />Clear</Button>
          </div>
          <div className="flex gap-2">
            {!isLast && <Button variant="outline" onClick={onFlagNext} className="hidden sm:inline-flex"><Bookmark />Review & next</Button>}
            <Button onClick={onNext}>{isLast ? 'Finish' : 'Save & next'}{!isLast && <ChevronRight />}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CodingView({ question, answer, onChange, flagged, onFlag, onPrev, onNext, position }: {
  question: CodingQuestion; answer: CodeAnswer | null; onChange: (value: CodeAnswer) => void; flagged: boolean; onFlag: () => void; onPrev?: () => void; onNext?: () => void; position: string
}) {
  const initialLanguage = validLanguage(answer?.language ?? '') ? answer!.language : validLanguage(question.language) ? question.language : 'cpp'
  const [language, setLanguage] = useState(initialLanguage)
  const template = (lang: string) => (question.starterCode && lang === (validLanguage(question.language) ? question.language : 'cpp') ? question.starterCode : STARTER_CODE[lang] ?? '')
  const [code, setCode] = useState(answer?.code || template(initialLanguage))
  const [copied, setCopied] = useState<number | null>(null)
  
  // Execution & Console States
  const [isRunning, setIsRunning] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submittedAt, setSubmittedAt] = useState<string | null>(answer?.code ? 'Saved in session' : null)
  const [consoleOpen, setConsoleOpen] = useState(true)
  const [activeTab, setActiveTab] = useState<'testcases' | 'results' | 'terminal'>('testcases')
  const [selectedCaseIdx, setSelectedCaseIdx] = useState(0)
  const [customInputEnabled, setCustomInputEnabled] = useState(false)
  const [customStdin, setCustomStdin] = useState('')
  
  // Result States
  const [testResults, setTestResults] = useState<Array<{ testCase: number; passed: boolean; input: string; expected: string; actual: string }>>([])
  const [overallPassed, setOverallPassed] = useState<boolean | null>(null)
  const [terminalOutput, setTerminalOutput] = useState<{ stdout: string; stderr: string; time?: string | null; memory?: string | null } | null>(null)
  const [execError, setExecError] = useState<string | null>(null)

  // Split pane resizing state (persisted across questions & reload)
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('exam_coding_split_ratio')
        if (saved) {
          const parsed = parseFloat(saved)
          if (!isNaN(parsed) && parsed >= 20 && parsed <= 75) return parsed
        }
      } catch {}
    }
    return 42
  })
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleSplitMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      if (rect.width <= 0) return
      const rawPercent = ((e.clientX - rect.left) / rect.width) * 100
      const clamped = Math.min(Math.max(rawPercent, 20), 75)
      setSplitRatio(clamped)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      try {
        localStorage.setItem('exam_coding_split_ratio', splitRatio.toString())
      } catch {}
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, splitRatio])

  const { confirm, toast } = useFeedback()

  function changeLanguage(next: string) {
    const untouched = !code.trim() || code === template(language)
    setLanguage(next)
    if (untouched) setCode(template(next))
    if (answer) onChange({ language: next, code: untouched ? template(next) : code })
  }

  function edit(next: string) {
    setCode(next)
    onChange({ language, code: next })
  }

  async function reset() {
    if (!(await confirm({ title: 'Reset your code?', description: 'Your code for this problem will be replaced with the starter template.', confirmLabel: 'Reset code', tone: 'danger' }))) return
    edit(template(language))
    toast('Code reset to default starter template.', 'info')
  }

  // ── Run Code (Runs student's code against sample test cases or custom input) ──
  const handleRun = useCallback(async () => {
    if (isRunning || isSubmitting) return
    setIsRunning(true)
    setExecError(null)
    setConsoleOpen(true)

    try {
      if (customInputEnabled) {
        // Run with custom stdin -> output to terminal
        const res = await fetch('/api/compile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            language,
            code,
            stdin: customStdin,
          })
        })
        const data = await res.json()
        if (!res.ok) {
          setExecError(data.error || `Execution error (${res.status})`)
          setActiveTab('terminal')
          return
        }
        if (data.run) {
          setTerminalOutput(data.run)
          setActiveTab('terminal')
        }
      } else {
        // Run against sample test cases -> compare and show in Test Results tab
        const samples = question.samples && question.samples.length > 0
          ? question.samples.map(s => ({ input: s.input, expectedOutput: s.output }))
          : [{ input: '', expectedOutput: '' }]

        const res = await fetch('/api/compile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            language,
            code,
            testCases: samples,
          })
        })
        const data = await res.json()
        if (!res.ok) {
          setExecError(data.error || `Execution error (${res.status})`)
          setActiveTab('results')
          return
        }
        if (data.testResults) {
          setTestResults(data.testResults)
          setOverallPassed(data.overallPassed ?? false)
          setActiveTab('results')
        } else if (data.run) {
          setTerminalOutput(data.run)
          setActiveTab('terminal')
        }
      }
    } catch {
      setExecError('Could not reach compiler sandbox. Please ensure Docker container or compiler is running.')
      setActiveTab('terminal')
    } finally {
      setIsRunning(false)
    }
  }, [isRunning, isSubmitting, language, code, customInputEnabled, customStdin, question.samples])

  // ── Run Single Case (Runs a specific sample test case and shows output in Console) ──
  const handleRunSingleCase = useCallback(async (caseIdx: number) => {
    if (isRunning || isSubmitting) return
    setIsRunning(true)
    setExecError(null)
    setConsoleOpen(true)

    try {
      const input = customInputEnabled
        ? customStdin
        : (question.samples && question.samples[caseIdx] ? question.samples[caseIdx].input : '')

      const res = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language,
          code,
          stdin: input,
        })
      })

      const data = await res.json()
      if (!res.ok) {
        setExecError(data.error || `Execution error (${res.status})`)
        setActiveTab('terminal')
        return
      }

      if (data.run) {
        setTerminalOutput(data.run)
        setActiveTab('terminal')
      }
    } catch {
      setExecError('Could not reach compiler sandbox.')
      setActiveTab('terminal')
    } finally {
      setIsRunning(false)
    }
  }, [isRunning, isSubmitting, language, code, customInputEnabled, customStdin, question.samples])

  // ── Submit Code (Evaluates all test cases, saves answer with marks, marks problem) ──
  const handleSubmitCode = useCallback(async () => {
    if (isRunning || isSubmitting) return
    setIsSubmitting(true)
    setExecError(null)
    setConsoleOpen(true)

    try {
      // 1. Evaluate against all sample test cases
      const samples = (question.samples && question.samples.length > 0)
        ? question.samples.map(s => ({ input: s.input, expectedOutput: s.output }))
        : [{ input: '', expectedOutput: '' }]

      const payload = {
        language,
        code,
        testCases: samples,
      }

      const res = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await res.json()
      if (!res.ok) {
        setExecError(data.error || `Submission error (${res.status})`)
        setActiveTab('results')
        return
      }

      let passedCount = 0
      let totalCount = samples.length
      let calculatedMarks = 0
      const questionPoints = question.points ?? 10

      if (data.testResults && Array.isArray(data.testResults)) {
        setTestResults(data.testResults)
        totalCount = data.testResults.length
        passedCount = data.testResults.filter((r: { passed: boolean }) => r.passed).length
        const allPassed = passedCount === totalCount
        setOverallPassed(allPassed)
        
        // 100% score for all passed, proportional score for partial pass
        calculatedMarks = totalCount > 0
          ? (allPassed ? questionPoints : Math.round(((passedCount / totalCount) * questionPoints) * 100) / 100)
          : 0

        setActiveTab('results')
      } else if (data.run) {
        setTerminalOutput(data.run)
        setActiveTab('terminal')
      }

      // 2. Save code & evaluation marks to attempt
      const codeAnswerWithScore = {
        language,
        code,
        passedCases: passedCount,
        totalCases: totalCount,
        marks: calculatedMarks,
      }
      onChange(codeAnswerWithScore)

      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      setSubmittedAt(timeStr)

      if (passedCount === totalCount && totalCount > 0) {
        toast(`Accepted! All ${totalCount} test cases passed. +${calculatedMarks}/${questionPoints} marks awarded (100%).`, 'success')
      } else if (passedCount > 0) {
        const percent = Math.round((passedCount / totalCount) * 100)
        toast(`Partial: ${passedCount}/${totalCount} test cases passed. +${calculatedMarks}/${questionPoints} marks awarded (${percent}%).`, 'info')
      } else {
        toast(`0/${totalCount} test cases passed. 0/${questionPoints} marks. You can improve your solution and submit again.`, 'error')
      }
    } catch {
      setExecError('Network error while submitting code.')
    } finally {
      setIsSubmitting(false)
    }
  }, [isRunning, isSubmitting, language, code, question.samples, question.points, onChange, toast])

  // Keyboard shortcut: Ctrl+Enter to Run, Ctrl+Shift+Enter to Submit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) {
          void handleSubmitCode()
        } else {
          void handleRun()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleRun, handleSubmitCode])

  return (
    <div
      ref={containerRef}
      style={{ ['--split-w' as string]: `${splitRatio}%` } as React.CSSProperties}
      className={cn('relative flex h-full flex-col lg:flex-row overflow-hidden', isDragging && 'select-none cursor-col-resize')}
    >
      {/* Drag overlay to prevent Monaco Editor / text from stealing pointer events during drag */}
      {isDragging && <div className="absolute inset-0 z-50 cursor-col-resize select-none" />}

      {/* ── Left Pane: Problem Description ───────────────────────────────── */}
      <section className="flex min-h-0 shrink-0 flex-col border-border max-lg:max-h-[42%] max-lg:border-b bg-card lg:w-[var(--split-w)]">
        {/* Problem Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md bg-violet/10 font-mono text-xs font-semibold text-violet">
              <Code2 className="size-4" />
            </span>
            <h2 className="truncate text-[15px] font-semibold text-foreground">{question.title}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">
              {question.points} marks
            </span>
            {submittedAt && (
              <span className="hidden items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 sm:inline-flex">
                <Check className="size-3" />Submitted
              </span>
            )}
            <button
              onClick={onFlag}
              aria-label={flagged ? 'Unmark review' : 'Mark for review'}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                flagged ? 'border-brand bg-warning-soft text-warning' : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              {flagged ? <BookmarkCheck className="size-3.5" /> : <Bookmark className="size-3.5" />}
              <span className="hidden sm:inline">{flagged ? 'Marked' : 'Review'}</span>
            </button>
          </div>
        </div>

        {/* Problem Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 text-foreground space-y-6">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Problem Description</h3>
            <p className="mt-2 text-[14.5px] leading-7 text-foreground/90 whitespace-pre-wrap">{question.text}</p>
            {question.imageUrl && (
              <div className="mt-3 max-w-full overflow-hidden rounded-lg border border-border bg-card p-1 shadow-xs">
                <img
                  src={question.imageUrl}
                  alt={`${question.title} diagram`}
                  className="max-h-72 w-auto max-w-full rounded object-contain"
                />
              </div>
            )}
          </div>

          {question.inputFormat && (
            <div className="rounded-lg border border-border bg-muted/30 p-3.5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Input Format</h4>
              <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-6 text-foreground">{question.inputFormat}</p>
            </div>
          )}

          {question.outputFormat && (
            <div className="rounded-lg border border-border bg-muted/30 p-3.5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Output Format</h4>
              <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-6 text-foreground">{question.outputFormat}</p>
            </div>
          )}

          {question.constraints && (
            <div className="rounded-lg border border-border bg-muted/30 p-3.5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Constraints</h4>
              <pre className="mt-1.5 whitespace-pre-wrap font-mono text-[12.5px] text-foreground/90">{question.constraints}</pre>
            </div>
          )}

          {/* Sample Test Cases */}
          {question.samples && question.samples.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sample Test Cases</h3>
              {question.samples.map((sample, i) => (
                <div key={i} className="overflow-hidden rounded-lg border border-border bg-muted/20">
                  <div className="flex items-center justify-between border-b border-border bg-muted/60 px-3.5 py-1.5 text-xs font-semibold">
                    <span>Sample Case {i + 1}</span>
                    <button
                      onClick={() => {
                        allowClipboardText(sample.input)
                        navigator.clipboard?.writeText(sample.input)
                        setCopied(i)
                        window.setTimeout(() => setCopied(null), 1200)
                      }}
                      className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      {copied === i ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                      {copied === i ? 'Copied' : 'Copy Input'}
                    </button>
                  </div>
                  <div className="grid gap-2 p-3 sm:grid-cols-2">
                    <div>
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase">Input</span>
                      <pre className="mt-1 max-h-32 overflow-x-auto rounded border border-border bg-card p-2 font-mono text-[12px]">{sample.input || ' '}</pre>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase">Expected Output</span>
                      <pre className="mt-1 max-h-32 overflow-x-auto rounded border border-border bg-card p-2 font-mono text-[12px]">{sample.output || ' '}</pre>
                    </div>
                  </div>
                  {sample.explanation && (
                    <p className="border-t border-border px-3.5 py-2 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">Explanation: </span>{sample.explanation}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Draggable Splitter Handle (Desktop) ────────────────────────── */}
      <div
        onMouseDown={handleSplitMouseDown}
        onDoubleClick={() => {
          setSplitRatio(42)
          try { localStorage.setItem('exam_coding_split_ratio', '42') } catch {}
        }}
        className={cn(
          'group relative hidden lg:flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-border/40 hover:bg-primary/20 transition-colors z-20 select-none border-x border-border/40',
          isDragging && 'bg-primary/30 border-primary/50'
        )}
        title="Drag to resize panels (Double-click to reset)"
      >
        {/* Visual grip handle */}
        <div className={cn(
          'flex flex-col gap-1 items-center justify-center py-2 px-0.5 rounded transition-all',
          isDragging ? 'bg-primary text-white scale-110 shadow-sm' : 'bg-muted-foreground/30 text-muted-foreground group-hover:bg-primary group-hover:text-white'
        )}>
          <div className="w-0.5 h-3 rounded-full bg-current opacity-80" />
          <div className="w-0.5 h-3 rounded-full bg-current opacity-80" />
        </div>
      </div>

      {/* ── Right Pane: Professional Code Editor & Interactive Console ────── */}
      <section className="flex min-h-0 flex-1 flex-col bg-[#1e1e1e] overflow-hidden">
        {/* Editor Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/40 bg-[#252526] px-3.5 py-2">
          {/* Left toolbar items */}
          <div className="flex items-center gap-2.5">
            <Select
              value={language}
              onChange={e => changeLanguage(e.target.value)}
              aria-label="Select Programming Language"
              className="h-8 w-44 rounded border-white/10 bg-[#333333] text-[13px] font-medium text-white focus:border-primary focus:ring-1 focus:ring-primary"
            >
              {LANGUAGE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>

            <button
              onClick={reset}
              className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors"
              title="Reset code template"
            >
              <RotateCcw className="size-3.5" />
              <span className="hidden sm:inline">Reset</span>
            </button>
          </div>

          {/* Right toolbar action buttons */}
          <div className="flex items-center gap-2">
            {/* Custom Input Toggle */}
            <label className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-white/70 hover:text-white cursor-pointer select-none">
              <input
                type="checkbox"
                checked={customInputEnabled}
                onChange={e => {
                  setCustomInputEnabled(e.target.checked)
                  if (e.target.checked) setActiveTab('testcases')
                }}
                className="size-3.5 rounded accent-primary cursor-pointer"
              />
              <span className="hidden md:inline">Custom Input</span>
            </label>

            {/* Run Code Button */}
            <button
              onClick={() => void handleRun()}
              disabled={isRunning || isSubmitting}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-all',
                isRunning
                  ? 'cursor-wait bg-white/15 text-white/50'
                  : 'bg-white/10 text-white hover:bg-white/20 active:scale-95'
              )}
              title="Run code against sample test cases (Ctrl + Enter)"
            >
              {isRunning ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5 fill-current" />}
              <span>{isRunning ? 'Running…' : 'Run Code'}</span>
            </button>

            {/* Submit Code Button */}
            <button
              onClick={() => void handleSubmitCode()}
              disabled={isRunning || isSubmitting}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-semibold text-white shadow-md transition-all',
                isSubmitting
                  ? 'cursor-wait bg-emerald-700 opacity-70'
                  : 'bg-emerald-600 hover:bg-emerald-500 active:scale-95'
              )}
              title="Submit code for final evaluation (Ctrl + Shift + Enter)"
            >
              {isSubmitting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              <span>{isSubmitting ? 'Submitting…' : 'Submit Code'}</span>
            </button>
          </div>
        </div>

        {/* Monaco Editor Container */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <CodeEditor value={code} onChange={edit} language={language} />
        </div>

        {/* ── Collapsible Bottom Console Drawer ────────────────────────────── */}
        <div className={cn('flex flex-col border-t border-black/40 bg-[#1e1e1e] transition-all', consoleOpen ? 'h-64' : 'h-9')}>
          {/* Console Header Tabs */}
          <div className="flex items-center justify-between border-b border-black/30 bg-[#252526] px-3">
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setActiveTab('testcases'); setConsoleOpen(true) }}
                className={cn(
                  'flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors',
                  activeTab === 'testcases' && consoleOpen
                    ? 'border-primary text-white'
                    : 'border-transparent text-white/60 hover:text-white'
                )}
              >
                <Sliders className="size-3.5" />
                <span>Test Cases</span>
              </button>

              <button
                onClick={() => { setActiveTab('results'); setConsoleOpen(true) }}
                className={cn(
                  'flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors',
                  activeTab === 'results' && consoleOpen
                    ? 'border-primary text-white'
                    : 'border-transparent text-white/60 hover:text-white'
                )}
              >
                <CheckCircle2 className="size-3.5" />
                <span>Test Results</span>
                {overallPassed !== null && (
                  <span className={cn('ml-1 rounded px-1.5 py-0.2 text-[10px] font-bold', overallPassed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400')}>
                    {overallPassed ? 'PASSED' : 'FAILED'}
                  </span>
                )}
              </button>

              <button
                onClick={() => { setActiveTab('terminal'); setConsoleOpen(true) }}
                className={cn(
                  'flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors',
                  activeTab === 'terminal' && consoleOpen
                    ? 'border-primary text-white'
                    : 'border-transparent text-white/60 hover:text-white'
                )}
              >
                <Terminal className="size-3.5" />
                <span>Console</span>
              </button>
            </div>

            <button
              onClick={() => setConsoleOpen(!consoleOpen)}
              className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
              title={consoleOpen ? 'Collapse console' : 'Expand console'}
            >
              {consoleOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
            </button>
          </div>

          {/* Console Content Area */}
          {consoleOpen && (
            <div className="min-h-0 flex-1 overflow-y-auto p-3.5 font-mono text-[12.5px] text-white/90">
              {/* 1. Test Cases Tab */}
              {activeTab === 'testcases' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/50">Select a test case or provide custom input to run:</span>
                    <button
                      onClick={() => void handleRunSingleCase(selectedCaseIdx)}
                      disabled={isRunning || isSubmitting}
                      className="flex items-center gap-1.5 rounded bg-white/10 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/20 transition-colors"
                    >
                      <Play className="size-3 fill-current text-emerald-400" />
                      <span>{customInputEnabled ? 'Run Custom Input' : `Run Case ${selectedCaseIdx + 1}`}</span>
                    </button>
                  </div>

                  {customInputEnabled ? (
                    <div>
                      <label className="block text-xs font-semibold text-white/70 uppercase tracking-wider mb-1.5">Custom Standard Input (stdin)</label>
                      <textarea
                        rows={5}
                        value={customStdin}
                        onChange={e => setCustomStdin(e.target.value)}
                        placeholder="Enter custom input to feed into your program..."
                        className="w-full rounded border border-white/15 bg-[#141414] p-2.5 font-mono text-xs text-white focus:border-primary focus:outline-none"
                      />
                    </div>
                  ) : question.samples && question.samples.length > 0 ? (
                    <div>
                      {/* Case selector pills */}
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {question.samples.map((_, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSelectedCaseIdx(idx)}
                            className={cn(
                              'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                              selectedCaseIdx === idx ? 'bg-white/20 text-white font-semibold ring-1 ring-white/30' : 'bg-white/5 text-white/60 hover:bg-white/10'
                            )}
                          >
                            Case {idx + 1}
                          </button>
                        ))}
                      </div>

                      {/* Selected Case View */}
                      {question.samples[selectedCaseIdx] && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <div className="text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-1">stdin (Input)</div>
                            <pre className="max-h-28 overflow-x-auto rounded border border-white/10 bg-[#141414] p-2.5 text-xs text-white">
                              {question.samples[selectedCaseIdx].input || <span className="italic text-white/30">(empty)</span>}
                            </pre>
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-1">Expected stdout</div>
                            <pre className="max-h-28 overflow-x-auto rounded border border-white/10 bg-[#141414] p-2.5 text-xs text-emerald-300">
                              {question.samples[selectedCaseIdx].output || <span className="italic text-white/30">(empty)</span>}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-xs text-white/50">
                      No sample test cases configured for this problem. You can enable <span className="font-semibold text-white">Custom Input</span> above to provide custom stdin.
                    </div>
                  )}
                </div>
              )}

              {/* 2. Test Results Tab */}
              {activeTab === 'results' && (
                <div>
                  {isRunning || isSubmitting ? (
                    <div className="flex items-center gap-2 text-xs text-white/60 py-4">
                      <Loader2 className="size-4 animate-spin text-primary" />
                      <span>Compiling and executing code in sandbox…</span>
                    </div>
                  ) : execError ? (
                    <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-red-400">
                      <div className="font-semibold">Execution Error</div>
                      <pre className="mt-1 whitespace-pre-wrap text-xs">{execError}</pre>
                    </div>
                  ) : testResults.length > 0 ? (
                    <div className="space-y-3">
                      {/* Summary Banner with Score & Percentage */}
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#252526] p-3">
                        <div className="flex items-center gap-2">
                          {overallPassed ? (
                            <span className="flex items-center gap-1.5 font-semibold text-emerald-400 text-sm">
                              <CheckCircle2 className="size-4" />Accepted (100% Score) — {question.points} / {question.points} marks
                            </span>
                          ) : testResults.some(r => r.passed) ? (
                            <span className="flex items-center gap-1.5 font-semibold text-amber-400 text-sm">
                              <AlertTriangle className="size-4" />Partially Passed ({Math.round((testResults.filter(r => r.passed).length / testResults.length) * 100)}% Score) — {Math.round(((testResults.filter(r => r.passed).length / testResults.length) * question.points) * 100) / 100} / {question.points} marks
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 font-semibold text-red-400 text-sm">
                              <CircleX className="size-4" />Wrong Answer (0% Score) — 0 / {question.points} marks
                            </span>
                          )}
                        </div>
                        <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-xs text-white/80">
                          {testResults.filter(r => r.passed).length} of {testResults.length} cases passed
                        </span>
                      </div>

                      {/* Case selector pills for results */}
                      <div className="flex flex-wrap gap-1.5">
                        {testResults.map((tr, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSelectedCaseIdx(idx)}
                            className={cn(
                              'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                              selectedCaseIdx === idx ? 'ring-1 ring-white/40' : '',
                              tr.passed ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                            )}
                          >
                            <span className={cn('size-1.5 rounded-full', tr.passed ? 'bg-emerald-400' : 'bg-red-400')} />
                            Case {tr.testCase}
                          </button>
                        ))}
                      </div>

                      {/* Detail of selected result */}
                      {testResults[selectedCaseIdx] && (
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div>
                            <div className="text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-1">Input</div>
                            <pre className="max-h-24 overflow-x-auto rounded border border-white/10 bg-[#141414] p-2 text-xs text-white">
                              {testResults[selectedCaseIdx].input || '(empty)'}
                            </pre>
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-1">Expected Output</div>
                            <pre className="max-h-24 overflow-x-auto rounded border border-white/10 bg-[#141414] p-2 text-xs text-emerald-300">
                              {testResults[selectedCaseIdx].expected || '(empty)'}
                            </pre>
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-1">Your Output</div>
                            <pre className={cn('max-h-24 overflow-x-auto rounded border p-2 text-xs', testResults[selectedCaseIdx].passed ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-red-500/30 bg-red-500/5 text-red-300')}>
                              {testResults[selectedCaseIdx].actual || '(empty)'}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-xs text-white/50">
                      Click <span className="font-semibold text-emerald-400">Submit Code</span> to evaluate all test cases for marks.
                    </div>
                  )}
                </div>
              )}

              {/* 3. Terminal Output Tab */}
              {activeTab === 'terminal' && (
                <div>
                  {isRunning || isSubmitting ? (
                    <div className="flex items-center gap-2 text-xs text-white/60 py-4">
                      <Loader2 className="size-4 animate-spin text-primary" />
                      <span>Executing in sandbox…</span>
                    </div>
                  ) : execError ? (
                    <pre className="whitespace-pre-wrap text-red-400 bg-red-950/20 p-2.5 rounded border border-red-500/20">{execError}</pre>
                  ) : terminalOutput ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-white/10 pb-2 text-xs text-white/50">
                        <div className="flex items-center gap-3">
                          {terminalOutput.time && <span>Runtime: <strong className="text-white">{terminalOutput.time}</strong></span>}
                          {terminalOutput.memory && <span>Memory: <strong className="text-white">{terminalOutput.memory}</strong></span>}
                        </div>
                        <span className="text-emerald-400 font-medium text-[11px]">Execution Complete</span>
                      </div>

                      {/* Standard Output */}
                      <div>
                        <div className="text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-1">Program Output (stdout)</div>
                        {terminalOutput.stdout ? (
                          <pre className="max-h-36 overflow-x-auto rounded border border-white/10 bg-[#141414] p-2.5 text-xs text-emerald-300 whitespace-pre-wrap">
                            {terminalOutput.stdout}
                          </pre>
                        ) : (
                          <p className="text-xs italic text-white/40">No output printed.</p>
                        )}
                      </div>

                      {/* Standard Error (if any) */}
                      {terminalOutput.stderr && (
                        <div>
                          <div className="text-[11px] font-semibold text-red-400 uppercase tracking-wide mb-1">Errors & Diagnostics (stderr)</div>
                          <pre className="max-h-36 overflow-x-auto rounded border border-red-500/30 bg-red-950/20 p-2.5 text-xs text-red-300 whitespace-pre-wrap">
                            {terminalOutput.stderr}
                          </pre>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs italic text-white/40">Terminal output will appear here after running code.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Exam Navigation Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/40 bg-[#252526] px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="flex size-2 rounded-full bg-emerald-400" />
            <span className="text-xs text-white/60">
              {submittedAt ? `Saved · ${submittedAt}` : 'Saved automatically'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs tabular-nums text-white/40">{position}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={onPrev}
              disabled={!onPrev}
              className="border-white/15 bg-transparent text-white hover:bg-white/10"
            >
              <ChevronLeft className="size-4" />Previous
            </Button>
            <Button
              size="sm"
              onClick={() => {
                void handleSubmitCode()
                onNext?.()
              }}
              disabled={!onNext}
              className="bg-primary text-primary-foreground hover:bg-primary-hover"
            >
              Save & Next<ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}

function StatementSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="mt-6"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-7 text-foreground/90">{children}</p></div>
}

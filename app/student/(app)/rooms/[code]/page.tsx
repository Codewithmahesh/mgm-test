'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, Clock3, Code2, Hand, ListChecks, Loader2, PlayCircle, ShieldAlert, Trophy, UserRound, XCircle } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardHeader, PageLoader } from '@/components/ui/card'
import { Alert, Checkbox } from '@/components/ui/form'
import { api, errorMessage, formatDate } from '@/lib/api'
import { lockExamKeys } from '@/components/use-proctoring'

type Lobby = {
  room: { code: string; title: string; description: string; instructions: string; teacher: string; department: string; durationMinutes: number; mcqCount: number; codingCount: number; marksPerQuestion: number; negativeMarks: number; codingMarks: number; startsAt: string | null; status: string; requireFullscreen: boolean; blockCopyPaste: boolean; maxViolations: number; requireApproval: boolean }
  request: { status: 'pending' | 'admitted' | 'rejected'; requestedAt: string; decidedAt: string | null } | null
  attempt: { id: string; status: string; endsAt: string } | null
  blocker: string | null
}

export default function LobbyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  const router = useRouter()
  const [data, setData] = useState<Lobby | null>(null)
  const [error, setError] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [starting, setStarting] = useState(false)
  const [requesting, setRequesting] = useState(false)

  const load = useCallback(() => api<Lobby>(`/api/student/rooms/${code}`).then(next => { setData(next); setError('') }).catch(err => setError(errorMessage(err))), [code])
  const waitingForFaculty = data?.request?.status === 'pending'

  // Check every 3 seconds while waiting to be admitted (so admission shows up instantly),
  // otherwise every 15 seconds (e.g. waiting for the room to open).
  useEffect(() => {
    load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, waitingForFaculty ? 3000 : 15_000)
    return () => window.clearInterval(timer)
  }, [load, waitingForFaculty])

  async function requestJoin() {
    setRequesting(true)
    setError('')
    try { await api(`/api/student/rooms/${code}/request`, { method: 'POST' }); await load() } catch (err) { setError(errorMessage(err)) } finally { setRequesting(false) }
  }
  async function cancelRequest() {
    try { await api(`/api/student/rooms/${code}/request`, { method: 'DELETE' }); await load() } catch (err) { setError(errorMessage(err)) }
  }

  async function start() {
    setStarting(true)
    // Enter fullscreen on this click (browsers only allow it from a user action); it carries over to the exam page.
    if (data?.room.requireFullscreen && document.fullscreenEnabled && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen().then(lockExamKeys).catch(() => {})
    }
    try {
      const result = await api<{ attemptId: string }>(`/api/student/rooms/${code}/start`, { method: 'POST' })
      router.push(`/student/exam/${result.attemptId}`)
    } catch (err) { setError(errorMessage(err)); setStarting(false) }
  }

  if (error && !data) return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <AlertTriangle className="mx-auto size-8 text-warning" />
      <h1 className="mt-4 text-xl font-medium">Can&apos;t open this exam</h1>
      <p className="mt-2 text-sm text-muted-foreground">{error}</p>
      <Link href="/student" className={buttonVariants({ variant: 'outline', className: 'mt-6' })}><ArrowLeft />Back to dashboard</Link>
    </div>
  )
  if (!data) return <PageLoader />
  const { room, attempt, blocker, request } = data
  const needsAdmission = room.requireApproval && request?.status !== 'admitted'
  const total = room.mcqCount * room.marksPerQuestion + room.codingCount * room.codingMarks
  const rules = room.instructions.split('\n').map(line => line.trim()).filter(Boolean)

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/student" className="text-[13px] text-muted-foreground hover:text-foreground">← Dashboard</Link>
      <div className="mt-2 flex flex-col gap-1">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-primary">Room {room.code}</p>
        <h1 className="text-2xl font-medium tracking-tight">{room.title}</h1>
        {room.description && <p className="text-sm text-muted-foreground">{room.description}</p>}
        {room.teacher && <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground"><UserRound className="size-3.5" />{room.teacher}{room.department && ` · ${room.department}`}</p>}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        {[
          { icon: Clock3, label: 'Duration', value: `${room.durationMinutes} min` },
          { icon: ListChecks, label: 'MCQs', value: room.mcqCount ? `${room.mcqCount} × ${room.marksPerQuestion}` : 'None' },
          { icon: Code2, label: 'Coding', value: room.codingCount ? `${room.codingCount} × ${room.codingMarks}` : 'None' },
          { icon: Trophy, label: 'Total marks', value: total },
        ].map(item => (
          <Card key={item.label} className="p-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><item.icon className="size-3.5" />{item.label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{item.value}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader title="Instructions" description="Read these carefully before you start." />
        <ul className="flex flex-col gap-2.5 p-5 text-sm leading-6">
          {room.negativeMarks > 0 && <li className="flex gap-3 font-medium text-warning"><span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-current" />Negative marking: −{room.negativeMarks} for each wrong MCQ answer. Unanswered questions score 0.</li>}
          {rules.map((rule, i) => <li key={i} className="flex gap-3"><span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-subtle" />{rule}</li>)}
          {room.codingCount > 0 && <li className="flex gap-3"><span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-subtle" />Coding problems read from standard input and write to standard output. Pick your language in the editor.</li>}
        </ul>
      </Card>

      <Card className="mt-6 border-warning-border">
        <CardHeader title="This exam is proctored" description="The following are monitored and reported to your faculty." />
        <ul className="grid gap-2.5 p-5 text-[13px] leading-5 sm:grid-cols-2">
          {[
            room.requireFullscreen && 'The exam runs in fullscreen. Leaving fullscreen is recorded.',
            'Switching tabs or windows is recorded.',
            room.blockCopyPaste && 'Copy, paste and right-click are disabled.',
            'The exam can be open on only one device or tab at a time.',
            'Developer-tool, save and print shortcuts are blocked and recorded.',
            'Your IP address and a watermark with your email are on the paper.',
          ].filter(Boolean).map(rule => <li key={rule as string} className="flex gap-2.5"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />{rule}</li>)}
        </ul>
        {room.maxViolations > 0 && <div className="px-5 pb-5"><Alert tone="warning">After <b>{room.maxViolations}</b> violation{room.maxViolations === 1 ? '' : 's'} your exam is submitted automatically.</Alert></div>}
      </Card>

      <Card className="mt-6">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          {attempt?.status === 'submitted' ? (
            <>
              <p className="text-sm">You&apos;ve already submitted this exam.</p>
              <Link href={`/student/results/${attempt.id}`} className={buttonVariants()}>View result</Link>
            </>
          ) : attempt ? (
            <>
              <p className="text-sm">Your exam is in progress. The timer is still running.</p>
              <Link href={`/student/exam/${attempt.id}`} className={buttonVariants({ variant: 'success', size: 'lg' })}><PlayCircle />Resume exam</Link>
            </>
          ) : blocker ? (
            <div className="flex w-full items-start gap-3">
              <CalendarClock className="mt-0.5 size-5 shrink-0 text-warning" />
              <div>
                <p className="text-sm font-medium">{blocker}</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{room.status === 'draft' || (room.startsAt && new Date(room.startsAt) > new Date()) ? 'This page checks again automatically every few seconds.' : 'Contact your faculty if you think this is a mistake.'}{room.startsAt && ` Scheduled for ${formatDate(room.startsAt, true)}.`}</p>
              </div>
            </div>
          ) : needsAdmission && request?.status === 'pending' ? (
            <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="relative mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
                  <Loader2 className="relative size-5 animate-spin" />
                </span>
                <div>
                  <p className="text-sm font-medium">Waiting for your faculty to admit you…</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">Requested {new Date(request.requestedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}. Keep this page open; it updates automatically the moment you&apos;re admitted.</p>
                </div>
              </div>
              <Button variant="ghost" onClick={cancelRequest} className="shrink-0">Cancel request</Button>
            </div>
          ) : needsAdmission && request?.status === 'rejected' ? (
            <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <XCircle className="mt-0.5 size-5 shrink-0 text-danger" />
                <div>
                  <p className="text-sm font-medium">Your faculty declined your request.</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">If this is a mistake, speak to your faculty and request again.</p>
                </div>
              </div>
              <Button variant="outline" onClick={requestJoin} disabled={requesting} className="shrink-0"><Hand />{requesting ? 'Requesting…' : 'Request again'}</Button>
            </div>
          ) : needsAdmission ? (
            <>
              <div className="flex items-start gap-3">
                <Hand className="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium">Ask to join this exam</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">Your faculty admits students from the waiting room. Once you&apos;re admitted you can start; your timer begins only when you press Start.</p>
                </div>
              </div>
              <Button size="lg" onClick={requestJoin} disabled={requesting} className="shrink-0"><Hand />{requesting ? 'Requesting…' : 'Request to join'}</Button>
            </>
          ) : (
            <div className="flex w-full flex-col gap-4">
              {room.requireApproval && <p className="flex items-center gap-2 text-sm font-medium text-success animate-in fade-in slide-in-from-top-1"><CheckCircle2 className="size-4" />You&apos;ve been admitted. Start whenever you&apos;re ready.</p>}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <Checkbox checked={agreed} onChange={e => setAgreed(e.target.checked)} label={<span className="text-sm">I have read the instructions. I&apos;m ready to start; the {room.durationMinutes}-minute timer begins immediately.</span>} />
                <Button size="lg" disabled={!agreed || starting} onClick={start} className="shrink-0"><PlayCircle />{starting ? 'Starting…' : 'Start exam'}</Button>
              </div>
            </div>
          )}
        </div>
        {error && <div className="px-5 pb-5"><Alert>{error}</Alert></div>}
      </Card>
    </div>
  )
}

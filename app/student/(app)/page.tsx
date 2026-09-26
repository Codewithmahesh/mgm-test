'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Award, CheckCircle2, ClipboardList, Clock3, KeyRound, PlayCircle, ShieldCheck, TrendingUp } from 'lucide-react'
import { BarChart } from '@/components/bar-chart'
import { Emblem } from '@/components/brand'
import { useStudent } from '@/components/role-context'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge, Card, CardHeader, EmptyState, Spinner } from '@/components/ui/card'
import { Input } from '@/components/ui/form'
import { api, errorMessage, formatDate, relativeTime } from '@/lib/api'
import { cn } from '@/lib/utils'

type MyAttempt = {
  id: string
  room: { title: string; code: string; status: string }
  status: 'in_progress' | 'submitted'
  startedAt: string
  endsAt: string
  submittedAt: string | null
  totalQuestions: number
  resultVisible: boolean
  score: number | null
  maxScore: number | null
  codingPending: number | null
}

export default function StudentDashboard() {
  const { student } = useStudent()
  const router = useRouter()
  const [code, setCode] = useState('')
  const [attempts, setAttempts] = useState<MyAttempt[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<{ attempts: MyAttempt[] }>('/api/student/attempts').then(d => setAttempts(d.attempts)).catch(err => setError(errorMessage(err))) }, [])

  const stats = useMemo(() => {
    const list = attempts ?? []
    const done = list.filter(a => a.status === 'submitted')
    const scored = done.filter(a => a.resultVisible && a.maxScore)
    const percents = scored.map(a => Math.round(((a.score ?? 0) / (a.maxScore || 1)) * 100))
    return {
      ongoing: list.filter(a => a.status === 'in_progress'),
      done,
      average: percents.length ? Math.round(percents.reduce((s, p) => s + p, 0) / percents.length) : null,
      best: percents.length ? Math.max(...percents) : null,
      chart: scored.slice(0, 10).reverse().map(a => ({ label: a.room.title.length > 16 ? `${a.room.title.slice(0, 15)}…` : a.room.title, value: Math.round(((a.score ?? 0) / (a.maxScore || 1)) * 100), detail: `${a.score} / ${a.maxScore}` })),
    }
  }, [attempts])

  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const first = student?.name?.split(' ')[0]

  return (
    <div className="flex flex-col gap-6">
      {/* Join banner */}
      <section id="join" className="relative scroll-mt-24 overflow-hidden rounded-xl bg-navy px-6 py-8 text-white shadow-[0_8px_30px_rgba(11,18,32,0.18)] sm:px-8">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:28px_28px]" />
        <div aria-hidden className="pointer-events-none absolute -left-20 -bottom-32 size-80 rounded-full bg-brand/15 blur-3xl" />
        <Emblem size={170} className="pointer-events-none absolute -right-4 top-1/2 hidden -translate-y-1/2 opacity-[0.12] lg:block" />
        <div className="relative max-w-2xl">
          <p className="text-sm text-white/60">{[student?.classLabel, student?.rollNumber && `Roll ${student.rollNumber}`].filter(Boolean).join(' · ') || 'Welcome'}</p>
          <h1 className="mt-1 text-2xl font-medium tracking-tight sm:text-3xl">Hi{first ? `, ${first}` : ''}</h1>
          <p className="mt-6 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-brand"><KeyRound className="size-3.5" />Join an exam</p>
          <form onSubmit={e => { e.preventDefault(); if (clean.length >= 4) router.push(`/student/rooms/${clean}`) }} className="mt-3 flex max-w-lg gap-2">
            <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Room code, e.g. K3B2FM" maxLength={12} aria-label="Room code" className="h-12 border-white/15 bg-white/10 font-mono text-lg tracking-[0.2em] text-white placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:text-white/40 focus:border-brand focus:ring-brand/20" />
            <Button type="submit" size="xl" disabled={clean.length < 4} className="h-12 bg-primary text-primary-foreground hover:bg-primary-hover">Continue<ArrowRight /></Button>
          </form>
          <p className="mt-3 text-xs text-white/50">Your faculty shares a six-character code when the exam opens.</p>
        </div>
      </section>

      {stats.ongoing.length > 0 && (
        <Card className="overflow-hidden border-success-border animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="flex items-center gap-2 border-b border-success-border bg-success-soft/60 px-5 py-3 text-sm font-semibold text-success"><span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" /><span className="relative size-2 rounded-full bg-success" /></span>Exam in progress — your timer is running</div>
          <ul>
            {stats.ongoing.map(a => (
              <li key={a.id} className="flex flex-col gap-3 border-b border-border px-5 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="font-medium">{a.room.title}</p><p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground"><Clock3 className="size-3.5" />Ends {relativeTime(a.endsAt)}</p></div>
                <Link href={`/student/exam/${a.id}`} className={buttonVariants({ variant: 'success', size: 'lg' })}><PlayCircle />Resume exam</Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Exams taken', value: stats.done.length, icon: ClipboardList, tone: 'bg-primary-soft text-primary' },
          { label: 'Average score', value: stats.average == null ? '—' : `${stats.average}%`, icon: TrendingUp, tone: 'bg-success-soft text-success' },
          { label: 'Best score', value: stats.best == null ? '—' : `${stats.best}%`, icon: Award, tone: 'bg-warning-soft text-warning' },
          { label: 'In progress', value: stats.ongoing.length, icon: PlayCircle, tone: 'bg-violet-soft text-violet' },
        ].map((kpi, i) => (
          <Card key={kpi.label} className="p-5 animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-500" style={{ animationDelay: `${i * 70}ms` }}>
            <div className="flex items-start justify-between"><p className="text-[13px] font-medium text-muted-foreground">{kpi.label}</p><span className={cn('flex size-9 items-center justify-center rounded-lg', kpi.tone)}><kpi.icon className="size-[18px]" /></span></div>
            <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{attempts ? kpi.value : '…'}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Your recent scores" description="Percentage scored in exams whose results are published" />
          <div className="px-5 pb-5 pt-2">
            {attempts ? <BarChart data={stats.chart} height={220} empty="Your scores appear here once results are published." /> : <div className="flex h-[220px] items-center justify-center"><Spinner /></div>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Before you start" />
          <ul className="flex flex-col gap-3.5 p-5 text-[13px] leading-5 text-muted-foreground">
            {[
              'Use a laptop or desktop with a stable connection.',
              'The exam opens in fullscreen. Escape is disabled; leaving fullscreen is recorded.',
              'Stay on the exam tab. Switching tabs or windows is recorded.',
              'Copy, paste and right-click are disabled during exams.',
              'Answers save automatically; the exam submits itself when time runs out.',
            ].map(tip => <li key={tip} className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />{tip}</li>)}
          </ul>
          <div className="mx-5 mb-5 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-primary" />Exams are proctored and one device at a time.</div>
        </Card>
      </div>

      <Card>
        <CardHeader title="My exams" description="Everything you've submitted, newest first" />
        {error ? <p className="p-5 text-sm text-danger">{error}</p> : !attempts ? <div className="flex justify-center py-12"><Spinner /></div> : stats.done.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No exams yet" description="When you finish an exam it shows up here with your result." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base min-w-[640px]">
              <thead><tr><th>Exam</th><th>Submitted</th><th>Score</th><th /></tr></thead>
              <tbody>
                {stats.done.map(a => {
                  const percent = a.resultVisible && a.maxScore ? Math.round(((a.score ?? 0) / a.maxScore) * 100) : null
                  return (
                    <tr key={a.id}>
                      <td><p className="font-medium">{a.room.title}</p><p className="font-mono text-xs text-muted-foreground">{a.room.code}</p></td>
                      <td className="text-[13px] text-muted-foreground">{formatDate(a.submittedAt, true)}</td>
                      <td>
                        {a.resultVisible ? (
                          <div className="flex items-center gap-3">
                            <span className="font-semibold tabular-nums">{a.score} <span className="font-normal text-muted-foreground">/ {a.maxScore}</span></span>
                            {percent != null && <Badge tone={percent >= 60 ? 'green' : percent >= 35 ? 'amber' : 'red'}>{percent}%</Badge>}
                          </div>
                        ) : <Badge>Result pending</Badge>}
                        {a.resultVisible && a.codingPending ? <div className="text-xs text-violet">{a.codingPending} coding to be graded</div> : null}
                      </td>
                      <td className="text-right"><Link href={`/student/results/${a.id}`} className={buttonVariants({ variant: 'outline', size: 'xs' })}>{a.resultVisible ? 'View result' : 'Details'}</Link></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

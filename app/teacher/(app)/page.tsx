'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, BookOpen, ChevronRight, ClipboardCheck, DoorOpen, FileUp, Plus, Radio, ShieldAlert, Sparkles, UserPlus, Users } from 'lucide-react'
import { BarChart } from '@/components/bar-chart'
import { Emblem } from '@/components/brand'
import { CopyCode, RoomStatusBadge } from '@/components/common'
import { useTeacher } from '@/components/role-context'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardHeader, EmptyState, PageLoader, Progress } from '@/components/ui/card'
import { Alert } from '@/components/ui/form'
import { api, errorMessage, relativeTime, type Room } from '@/lib/api'
import { cn } from '@/lib/utils'

type Dashboard = {
  stats: { questionTotal: number; questionsThisWeek: number; openRooms: number; studentsTakingNow: number; studentsTotal: number; studentsActive: number; pendingReview: number; totalRooms: number; completionPercent: number | null; studentsThisMonth: number }
  rooms: Room[]
  activity: { kind: 'ai' | 'import' | 'manual' | 'attempt'; title: string; detail: string; at: string }[]
}

const firstName = (name: string) => name.replace(/^(prof|dr|mr|mrs|ms|miss)\.?\s+/i, '').split(' ')[0]
const greeting = () => { const hour = new Date().getHours(); return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening' }

export default function TeacherDashboard() {
  const teacher = useTeacher()
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const load = () => api<Dashboard>('/api/dashboard').then(setData).catch(err => setError(errorMessage(err)))
    load()
    const timer = window.setInterval(load, 10_000)
    return () => window.clearInterval(timer)
  }, [])

  const derived = useMemo(() => {
    if (!data) return null
    const rooms = data.rooms
    const live = rooms.filter(r => r.status === 'open')
    const flagged = rooms.reduce((sum, r) => sum + (r.flagged ?? 0), 0)
    const notReady = rooms.filter(r => r.status !== 'closed' && (r.mcqPoolSize < r.questionsPerStudent || r.codingPoolSize < r.codingQuestions || r.poolSize === 0))
    const drafts = rooms.filter(r => r.status === 'draft')
    const chart = rooms.filter(r => r.averagePercent != null && r.submitted > 0).slice(0, 10).reverse()
      .map(r => ({ label: r.title.length > 18 ? `${r.title.slice(0, 17)}…` : r.title, value: r.averagePercent ?? 0, detail: `${r.submitted} submitted` }))
    const overallAvg = chart.length ? Math.round(chart.reduce((s, d) => s + d.value, 0) / chart.length) : null
    return { live, flagged, notReady, drafts, chart, overallAvg }
  }, [data])

  if (error) return <Alert>{error}</Alert>
  if (!data || !derived) return <PageLoader />
  const { stats, rooms, activity } = data
  const writing = stats.studentsTakingNow

  const kpis = [
    { label: 'Live exam rooms', value: stats.openRooms, hint: writing ? `${writing} student${writing === 1 ? '' : 's'} writing now` : `${stats.totalRooms} rooms in total`, icon: Radio, tone: 'green' as const, href: '/teacher/rooms' },
    { label: 'Students activated', value: stats.studentsActive, suffix: ` / ${stats.studentsTotal}`, hint: stats.studentsTotal ? `${Math.round((stats.studentsActive / stats.studentsTotal) * 100)}% of the student list` : 'Add students to begin', icon: Users, tone: 'blue' as const, href: '/teacher/students', progress: stats.studentsTotal ? (stats.studentsActive / stats.studentsTotal) * 100 : 0 },
    { label: 'Question bank', value: stats.questionTotal, hint: stats.questionsThisWeek ? `+${stats.questionsThisWeek} added this week` : 'Across all your rooms', icon: BookOpen, tone: 'violet' as const, href: '/teacher/questions' },
    { label: 'Average score', value: derived.overallAvg ?? '—', suffix: derived.overallAvg != null ? '%' : '', hint: `Across ${derived.chart.length} completed exam${derived.chart.length === 1 ? '' : 's'}`, icon: ClipboardCheck, tone: 'amber' as const, href: '/teacher/rooms' },
  ]

  const waitingRooms = rooms.filter(r => (r.waiting ?? 0) > 0)
  const waitingTotal = waitingRooms.reduce((sum, r) => sum + r.waiting, 0)
  const attention = [
    waitingTotal > 0 && { key: 'waiting', icon: Users, tone: 'red', title: `${waitingTotal} student${waitingTotal === 1 ? '' : 's'} waiting to join`, text: waitingRooms.length === 1 ? `In ${waitingRooms[0].title}. Admit them from the waiting room.` : `Across ${waitingRooms.length} rooms. Admit them from the waiting room.`, href: `/teacher/rooms/${waitingRooms[0]?.id}?tab=participants` },
    stats.pendingReview > 0 && { key: 'grading', icon: ClipboardCheck, tone: 'violet', title: `${stats.pendingReview} paper${stats.pendingReview === 1 ? '' : 's'} to grade`, text: 'Coding answers are waiting for marks.', href: `/teacher/rooms/${rooms.find(r => r.pendingReview > 0)?.id}?tab=leaderboard` },
    derived.flagged > 0 && { key: 'flagged', icon: ShieldAlert, tone: 'red', title: `${derived.flagged} student${derived.flagged === 1 ? '' : 's'} flagged`, text: 'Possible cheating: tab switches, pasting, second device…', href: `/teacher/rooms/${rooms.find(r => r.flagged > 0)?.id}?tab=participants` },
    ...derived.notReady.slice(0, 3).map(r => ({ key: `not-ready-${r.id}`, icon: AlertTriangle, tone: 'amber', title: `${r.title} isn't ready`, text: `Pool has ${r.mcqPoolSize}/${r.questionsPerStudent} MCQs${r.codingQuestions ? `, ${r.codingPoolSize}/${r.codingQuestions} coding` : ''}.`, href: `/teacher/rooms/${r.id}?tab=questions` })),
    derived.drafts.length > 0 && { key: 'drafts', icon: DoorOpen, tone: 'blue', title: `${derived.drafts.length} draft room${derived.drafts.length === 1 ? '' : 's'}`, text: 'Open a room when you are ready for students to join.', href: '/teacher/rooms' },
  ].filter(Boolean) as { key: string; icon: React.ComponentType<{ className?: string }>; tone: string; title: string; text: string; href: string }[]

  return (
    <div className="flex flex-col gap-6">
      {/* Welcome banner */}
      <section className="relative overflow-hidden rounded-xl bg-navy px-6 py-7 text-white shadow-[0_8px_30px_rgba(11,18,32,0.18)] sm:px-8">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:28px_28px]" />
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 size-80 rounded-full bg-brand/15 blur-3xl" />
        <Emblem size={180} className="pointer-events-none absolute -right-6 top-1/2 hidden -translate-y-1/2 opacity-[0.12] lg:block" />
        <div className="relative max-w-3xl">
          <div>
            <p className="text-sm text-white/60">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight sm:text-3xl">{greeting()}{teacher ? `, ${firstName(teacher.name)}` : ''}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/70">
              {derived.live.length > 0 ? (
                <span className="flex items-center gap-2"><span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-[#4ade80] opacity-70" /><span className="relative size-2 rounded-full bg-[#4ade80]" /></span>{derived.live.length} room{derived.live.length === 1 ? '' : 's'} live · {writing} writing</span>
              ) : <span>No exams running right now.</span>}
              {stats.pendingReview > 0 && <span>{stats.pendingReview} to grade</span>}
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link href="/teacher/rooms/new" className={cn(buttonVariants({ size: 'lg' }), 'bg-primary text-primary-foreground hover:bg-primary-hover')}><Plus />New exam room</Link>
            <Link href="/teacher/questions?add=ai" className={cn(buttonVariants({ size: 'lg', variant: 'outline' }), 'border-white/20 bg-white/5 text-white hover:bg-white/10')}><Sparkles />Generate with AI</Link>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi, i) => {
          const iconTone = { blue: 'bg-primary-soft text-primary', green: 'bg-success-soft text-success', amber: 'bg-warning-soft text-warning', violet: 'bg-violet-soft text-violet' }[kpi.tone]
          return (
            <Link key={kpi.label} href={kpi.href} className="group animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-500" style={{ animationDelay: `${i * 70}ms` }}>
              <Card className="h-full p-5 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[13px] font-medium text-muted-foreground">{kpi.label}</p>
                  <span className={cn('flex size-9 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-110', iconTone)}><kpi.icon className="size-[18px]" /></span>
                </div>
                <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{kpi.value}{kpi.suffix && <span className="text-base font-medium text-muted-foreground">{kpi.suffix}</span>}</p>
                {kpi.progress !== undefined && <Progress value={kpi.progress} className="mt-3" tone="green" />}
                <p className="mt-2 flex items-center justify-between text-xs text-muted-foreground">{kpi.hint}<ChevronRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" /></p>
              </Card>
            </Link>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Exam performance" description="Average score of students who submitted, per exam room" />
          <div className="px-5 pb-5 pt-2">
            <BarChart data={derived.chart} height={240} empty="Scores appear here after students submit their first exam." />
          </div>
        </Card>
        <Card>
          <CardHeader title="Needs attention" description={attention.length ? `${attention.length} item${attention.length === 1 ? '' : 's'}` : 'All caught up'} />
          {attention.length === 0 ? (
            <div className="flex flex-col items-center px-5 py-12 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-success-soft text-success"><ClipboardCheck className="size-5" /></span>
              <p className="mt-3 text-sm font-medium">Nothing needs you right now</p>
              <p className="mt-1 text-xs text-muted-foreground">Grading, flags and unready rooms show up here.</p>
            </div>
          ) : (
            <ul className="p-2">
              {attention.map(item => {
                const tone = { violet: 'bg-violet-soft text-violet', red: 'bg-danger-soft text-danger', amber: 'bg-warning-soft text-warning', blue: 'bg-primary-soft text-primary' }[item.tone]
                return (
                  <li key={item.key}>
                    <Link href={item.href} className="group flex items-start gap-3 rounded-lg p-3 transition-colors hover:bg-muted">
                      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', tone)}><item.icon className="size-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.title}</span><span className="block text-xs leading-5 text-muted-foreground">{item.text}</span></span>
                      <ArrowRight className="mt-2 size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Exam rooms" description="Most recent first" action={<Link href="/teacher/rooms" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>View all<ArrowRight /></Link>} />
          {rooms.length === 0 ? (
            <EmptyState icon={DoorOpen} title="No exam rooms yet" description="Create a room, add questions from a CSV, a PDF or AI, then share the code with your students." action={<Link href="/teacher/rooms/new" className={buttonVariants()}><Plus />Create your first room</Link>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base min-w-[720px]">
                <thead><tr><th>Room</th><th>Code</th><th>Paper</th><th className="w-48">Submissions</th><th>Status</th></tr></thead>
                <tbody>
                  {rooms.slice(0, 7).map(room => (
                    <tr key={room.id} className="cursor-pointer" onClick={() => { window.location.href = `/teacher/rooms/${room.id}` }}>
                      <td>
                        <Link href={`/teacher/rooms/${room.id}`} className="font-medium hover:text-primary">{room.title}</Link>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">Updated {relativeTime(room.updatedAt)}{room.flagged > 0 && <span className="inline-flex items-center gap-1 font-medium text-danger"><ShieldAlert className="size-3" />{room.flagged} flagged</span>}</div>
                      </td>
                      <td><CopyCode code={room.code} /></td>
                      <td className="text-[13px] text-muted-foreground">{room.questionsPerStudent} MCQ{room.codingQuestions ? ` + ${room.codingQuestions} coding` : ''}<div>{room.durationMinutes} min</div></td>
                      <td>
                        <div className="flex items-center gap-2"><Progress value={room.joined ? (room.submitted / room.joined) * 100 : 0} className="flex-1" tone={room.status === 'open' ? 'blue' : 'green'} /><span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{room.submitted}/{room.joined}</span></div>
                        {room.averagePercent != null && <div className="mt-1 text-xs text-muted-foreground">Avg {room.averagePercent}%</div>}
                      </td>
                      <td><RoomStatusBadge status={room.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Quick actions" />
            <div className="grid grid-cols-2 gap-2 p-3">
              {[
                { href: '/teacher/rooms/new', icon: Plus, label: 'New room' },
                { href: '/teacher/questions?add=ai', icon: Sparkles, label: 'AI questions' },
                { href: '/teacher/questions?add=csv', icon: FileUp, label: 'Import CSV' },
                { href: '/teacher/students?add=1', icon: UserPlus, label: 'Add students' },
              ].map(item => (
                <Link key={item.href} href={item.href} className="group flex flex-col items-start gap-2 rounded-lg border border-border p-3 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary-soft/40 hover:shadow-sm">
                  <span className="flex size-8 items-center justify-center rounded-md bg-primary-soft text-primary transition-transform group-hover:scale-110"><item.icon className="size-4" /></span>
                  <span className="text-[13px] font-medium">{item.label}</span>
                </Link>
              ))}
            </div>
          </Card>
          <Card className="flex-1">
            <CardHeader title="Recent activity" />
            {activity.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted-foreground">Nothing yet.</p> : (
              <ol className="relative mx-5 my-4 border-l border-border">
                {activity.map((item, index) => (
                  <li key={index} className="relative pb-4 pl-5 last:pb-0">
                    <span className={cn('absolute -left-[5px] top-1.5 size-2.5 rounded-full ring-4 ring-card', item.kind === 'attempt' ? 'bg-success' : item.kind === 'ai' ? 'bg-violet' : 'bg-primary')} />
                    <p className="text-[13px] font-medium leading-5">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.detail} · {relativeTime(item.at)}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

'use client'

import { AlertTriangle, Award, CheckCircle2, Clock3, Code2, Lightbulb, ListChecks, MinusCircle, Target, TrendingDown, TrendingUp, Trophy, Users, XCircle } from 'lucide-react'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { STRONG_AT, WEAK_BELOW, type AreaStat, type FocusArea, type MissedQuestion, type ResultAnalysis } from '@/lib/analysis-types'
import { cn } from '@/lib/utils'

const fmt = (value: number) => String(Math.round(value * 100) / 100)
const duration = (seconds: number | null) => (seconds == null ? '—' : seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`)
const barTone = (percent: number) => (percent >= STRONG_AT ? 'bg-success' : percent >= WEAK_BELOW ? 'bg-warning' : 'bg-danger')
const textTone = (percent: number) => (percent >= STRONG_AT ? 'text-success' : percent >= WEAK_BELOW ? 'text-warning' : 'text-danger')

/** The student's score analysis: overview, breakdown, topics and Bloom's levels, strong/weak areas and tips. */
export function ResultAnalysisView({ analysis: a, score, maxScore }: { analysis: ResultAnalysis; score: number; maxScore: number }) {
  return (
    <div className="flex flex-col gap-6">
      <Overview a={a} score={score} maxScore={maxScore} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric icon={Target} tone="bg-primary-soft text-primary" label="Accuracy" value={a.accuracy == null ? '—' : `${a.accuracy}%`} hint={a.attempted ? `${a.correct} of ${a.attempted} attempted MCQs right` : 'No MCQs attempted'} />
        <Metric icon={CheckCircle2} tone="bg-success-soft text-success" label="Correct · Wrong · Skipped" value={<span><span className="text-success">{a.correct}</span> · <span className="text-danger">{a.wrong}</span> · <span className="text-muted-foreground">{a.skipped}</span></span>} hint={a.negativeLost ? `−${fmt(a.negativeLost)} from negative marking` : 'No marks lost to negative marking'} />
        <Metric icon={Clock3} tone="bg-warning-soft text-warning" label="Time taken" value={duration(a.timeTakenSeconds)} hint={a.durationMinutes ? `of ${a.durationMinutes} minutes` : undefined} />
        <Metric icon={Users} tone="bg-violet-soft text-violet" label="Class rank" value={a.classStats ? `${a.classStats.rank} / ${a.classStats.of}` : '—'} hint={a.classStats ? `Better than ${a.classStats.percentile}% of the class` : 'Shown once others submit'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Score breakdown" description="Multiple choice and coding marks" />
          <div className="flex flex-col gap-5 p-5">
            <Bar icon={ListChecks} label="Multiple choice" earned={a.mcq.earned} possible={a.mcq.possible} detail={`${a.mcq.questions} question${a.mcq.questions === 1 ? '' : 's'}`} />
            {a.coding.questions > 0 && <Bar icon={Code2} label="Coding" earned={a.coding.earned} possible={a.coding.possible} detail={`${a.coding.questions} problem${a.coding.questions === 1 ? '' : 's'}${a.coding.pending ? ` · ${a.coding.pending} being graded` : ''}`} />}
          </div>
        </Card>
        <Card>
          <CardHeader title="You and your class" description={a.classStats ? `${a.classStats.of} students submitted` : 'Comparison appears once more students submit'} />
          <div className="flex flex-col gap-4 p-5">
            <Compare label="You" percent={a.percent} highlight />
            {a.classStats ? <>
              <Compare label="Class average" percent={a.classStats.average} />
              <Compare label="Top score" percent={a.classStats.highest} />
            </> : <p className="text-[13px] text-muted-foreground">You&apos;re the first to have a result in this exam.</p>}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <AreaCard title="By topic" description="Marks earned in each topic" areas={a.byTopic} empty="Questions in this exam have no topics." />
        <AreaCard title="By Bloom's level" description="From recall (L1) to creating (L6)" areas={a.byLevel} empty="Questions in this exam have no Bloom's levels." />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Highlights tone="good" title="Strong areas" icon={TrendingUp} areas={a.strong} empty={`Areas where you score ${STRONG_AT}% or more show up here.`} />
        <Highlights tone="bad" title="Areas to improve" icon={TrendingDown} areas={a.weak} empty={`Nothing below ${WEAK_BELOW}%. Well done.`} />
      </div>

      {a.focus.length > 0 && <FocusAreas focus={a.focus} />}

      {a.tips.length > 0 && (
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Lightbulb className="size-4 text-brand" />What to work on</span>} />
          <ul className="flex flex-col gap-3 p-5">
            {a.tips.map(tip => <li key={tip} className="flex gap-3 text-sm leading-6"><span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary" />{tip}</li>)}
          </ul>
        </Card>
      )}
    </div>
  )
}

function Overview({ a, score, maxScore }: { a: ResultAnalysis; score: number; maxScore: number }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const ring = a.percent >= STRONG_AT ? 'var(--success)' : a.percent >= WEAK_BELOW ? 'var(--warning)' : 'var(--danger)'
  return (
    <section className="relative overflow-hidden rounded-xl bg-navy px-6 py-7 text-white shadow-[0_8px_30px_rgba(11,18,32,0.18)] sm:px-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:28px_28px]" />
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 size-80 rounded-full bg-brand/15 blur-3xl" />
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="relative size-[132px] shrink-0">
          <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
            <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="10" />
            <circle cx="60" cy="60" r={radius} fill="none" stroke={ring} strokeWidth="10" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - a.percent / 100)} className="transition-[stroke-dashoffset] duration-1000 ease-out" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-semibold tabular-nums">{a.percent}%</span>
            <span className="text-[11px] uppercase tracking-wide text-white/55">score</span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-brand">Result analysis</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{fmt(score)} <span className="text-lg font-normal text-white/55">/ {fmt(maxScore)}</span></p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone={a.band.tone}><Award className="size-3" />{a.band.label}</Badge>
            {a.classStats && <span className="inline-flex items-center gap-1.5 text-sm text-white/70"><Trophy className="size-4 text-brand" />Rank {a.classStats.rank} of {a.classStats.of} · better than {a.classStats.percentile}% of the class</span>}
          </div>
          {(a.strong[0] || a.weak[0]) && (
            <p className="mt-3 text-sm text-white/70">
              {a.strong[0] && <>Strongest: <b className="font-semibold text-white">{a.strong[0].label}</b> ({a.strong[0].percent}%). </>}
              {a.weak[0] && <>Needs work: <b className="font-semibold text-white">{a.weak[0].label}</b> ({a.weak[0].percent}%).</>}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function Metric({ icon: Icon, tone, label, value, hint }: { icon: React.ComponentType<{ className?: string }>; tone: string; label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        <span className={cn('flex size-9 items-center justify-center rounded-md', tone)}><Icon className="size-[18px]" /></span>
      </div>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  )
}

function Bar({ icon: Icon, label, earned, possible, detail }: { icon: React.ComponentType<{ className?: string }>; label: string; earned: number; possible: number; detail: string }) {
  const percent = possible ? Math.max(0, Math.min(100, Math.round((earned / possible) * 100))) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium"><Icon className="size-4 text-muted-foreground" />{label}</span>
        <span className="text-sm tabular-nums"><b className="font-semibold">{fmt(earned)}</b><span className="text-muted-foreground"> / {fmt(possible)}</span> <span className={cn('ml-1 font-semibold', textTone(percent))}>{percent}%</span></span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full transition-all duration-700', barTone(percent))} style={{ width: `${Math.max(2, percent)}%` }} /></div>
      <p className="mt-1.5 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

function Compare({ label, percent, highlight }: { label: string; percent: number; highlight?: boolean }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)_48px] items-center gap-3">
      <span className={cn('text-[13px]', highlight ? 'font-semibold' : 'text-muted-foreground')}>{label}</span>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full', highlight ? 'bg-primary' : 'bg-border-strong')} style={{ width: `${Math.max(2, percent)}%` }} /></div>
      <span className={cn('text-right text-sm tabular-nums', highlight && 'font-semibold')}>{percent}%</span>
    </div>
  )
}

function AreaCard({ title, description, areas, empty }: { title: string; description: string; areas: AreaStat[]; empty: string }) {
  const shown = areas.filter(x => x.questions > 0)
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {shown.length === 0 ? <p className="p-5 text-sm text-muted-foreground">{empty}</p> : (
        <ul className="flex flex-col gap-4 p-5">
          {shown.map(area => (
            <li key={area.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium">{area.label}</span>
                <span className={cn('text-sm font-semibold tabular-nums', area.possible ? textTone(area.percent) : 'text-violet')}>{area.possible ? `${area.percent}%` : 'Grading'}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full transition-all duration-700', area.possible ? barTone(area.percent) : 'bg-violet')} style={{ width: `${area.possible ? Math.max(2, area.percent) : 100}%`, opacity: area.possible ? 1 : 0.35 }} /></div>
              <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                <span>{fmt(area.earned)} / {fmt(area.possible)} marks</span>
                <span className="inline-flex items-center gap-1"><CheckCircle2 className="size-3 text-success" />{area.correct}</span>
                <span className="inline-flex items-center gap-1"><XCircle className="size-3 text-danger" />{area.wrong}</span>
                {area.skipped > 0 && <span className="inline-flex items-center gap-1"><MinusCircle className="size-3" />{area.skipped} skipped</span>}
                {area.pending > 0 && <span className="text-violet">{area.pending} being graded</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Highlights({ tone, title, icon: Icon, areas, empty }: { tone: 'good' | 'bad'; title: string; icon: React.ComponentType<{ className?: string }>; areas: AreaStat[]; empty: string }) {
  return (
    <Card className={tone === 'good' ? 'border-success-border' : 'border-danger-border'}>
      <div className={cn('flex items-center gap-2 border-b px-5 py-3.5 text-sm font-semibold', tone === 'good' ? 'border-success-border bg-success-soft/60 text-success-ink' : 'border-danger-border bg-danger-soft/60 text-danger-ink')}>
        <Icon className="size-4" />{title}
      </div>
      {areas.length === 0 ? <p className="p-5 text-sm text-muted-foreground">{empty}</p> : (
        <ul className="flex flex-wrap gap-2 p-5">
          {areas.map(area => (
            <li key={area.key} className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium ring-1 ring-inset', tone === 'good' ? 'bg-success-soft text-success-ink ring-success-border' : 'bg-danger-soft text-danger-ink ring-danger-border')}>
              {area.label}<span className="tabular-nums opacity-80">{area.percent}%</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** Weak areas of this test, each with the exact questions the student missed there. */
function FocusAreas({ focus }: { focus: FocusArea[] }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold"><AlertTriangle className="size-5 text-danger" />What to improve from this test</h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">Your weakest areas, with the questions you missed in each. Read the explanation of every one.</p>
      </div>
      {focus.map(f => (
        <Card key={f.area.key} className="overflow-hidden border-danger-border">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-danger-border bg-danger-soft/50 px-5 py-4">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-danger-ink">You need to improve in {f.area.label}</p>
              <p className="mt-1 text-[13px] leading-5 text-danger-ink/90">{f.advice}</p>
            </div>
            <span className="shrink-0 rounded-full bg-danger px-2.5 py-1 text-xs font-semibold tabular-nums text-white">{f.area.percent}%</span>
          </div>
          {f.missed.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">No individual questions to show for this area.</p> : (
            <ul>{f.missed.map(m => <Missed key={m.number} m={m} />)}</ul>
          )}
        </Card>
      ))}
    </section>
  )
}

function Missed({ m }: { m: MissedQuestion }) {
  const status = m.result === 'skipped' ? { label: 'Skipped', tone: 'neutral' as const } : m.result === 'partial' ? { label: 'Partly solved', tone: 'amber' as const } : { label: 'Wrong', tone: 'red' as const }
  return (
    <li className="border-b border-border px-5 py-4 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-6"><span className="mr-2 font-mono text-xs text-subtle">Q{m.number}</span>{m.text}</p>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          {m.marksLost > 0 && <span className="text-xs font-semibold tabular-nums text-danger">−{fmt(m.marksLost)}</span>}
        </div>
      </div>
      {m.type === 'coding' ? (
        <div className="mt-2 flex flex-col gap-1.5 text-[13px]">
          <p className="text-muted-foreground">{m.marks ? <>Marks: <b className="font-semibold text-foreground">{fmt(m.marks.earned)} / {fmt(m.marks.possible)}</b></> : 'Not attempted'}</p>
          {m.feedback && <p className="rounded-md bg-muted px-3 py-2"><span className="font-medium">Feedback:</span> {m.feedback}</p>}
        </div>
      ) : (
        <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
          <div className={cn('rounded-md border px-3 py-2 text-[13px]', m.yourAnswer ? 'border-danger-border bg-danger-soft text-danger-ink' : 'border-border text-muted-foreground')}>
            <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-70">Your answer</span>{m.yourAnswer ?? 'Not answered'}
          </div>
          <div className="rounded-md border border-success-border bg-success-soft px-3 py-2 text-[13px] text-success-ink">
            <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-70">Correct answer</span>{m.correctAnswer ?? '—'}
          </div>
        </div>
      )}
      {m.explanation && <p className="mt-2 text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">Why:</span> {m.explanation}</p>}
    </li>
  )
}

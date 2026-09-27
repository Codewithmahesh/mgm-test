'use client'

import Link from 'next/link'
import { use, useEffect, useState } from 'react'
import { Check, CheckCircle2, Clock3, Code2, Hourglass, Minus, X } from 'lucide-react'
import { CodeEditor } from '@/components/code-editor'
import { Badge, Card, CardHeader, PageLoader, StatCard } from '@/components/ui/card'
import { Alert } from '@/components/ui/form'
import { api, errorMessage, formatDate, formatDuration, languageLabel, letter } from '@/lib/api'
import { cn } from '@/lib/utils'

type Item =
  | { number: number; type: 'mcq' | 'tf'; text: string; options: string[]; correctIndex: number; selected: number | null; explanation: string; marks?: number }
  | { number: number; type: 'coding'; title: string; points: number; answer: { language: string; code: string } | null; marks: number | null; feedback: string }
  | { number: number; type: 'removed' }

type Result = {
  room: { title: string; code: string; status: string; showResults: string }
  status: string; autoSubmitted: boolean; autoSubmitReason?: string; startedAt: string; submittedAt: string | null; totalQuestions: number; visible: boolean; set?: string
  score?: number; maxScore?: number; mcqScore?: number; codingScore?: number; correctCount?: number; wrongCount?: number; codingPending?: number
  items?: Item[]
}

export default function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<Result | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<Result>(`/api/student/attempts/${id}/result`).then(setData).catch(err => setError(errorMessage(err))) }, [id])

  if (error) return <Alert>{error}</Alert>
  if (!data) return <PageLoader />
  const taken = data.submittedAt ? Math.round((new Date(data.submittedAt).getTime() - new Date(data.startedAt).getTime()) / 1000) : null

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/student" className="text-[13px] text-muted-foreground hover:text-foreground">← Dashboard</Link>
      <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex flex-wrap items-center gap-2.5 text-2xl font-medium tracking-tight">{data.room.title}{data.set && <SetTag set={data.set} />}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Submitted {formatDate(data.submittedAt, true)}{data.autoSubmitted && ` · automatically ${{ violations: 'after too many exam-rule violations', faculty: 'by your faculty', room_closed: 'when the exam was ended' }[data.autoSubmitReason ?? ''] ?? 'when time ran out'}`}</p>
        </div>
      </div>

      {!data.visible ? (
        <Card className="mt-6">
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success"><CheckCircle2 className="size-6" /></span>
            <h2 className="mt-4 text-lg font-semibold">Your answers were submitted</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {data.room.showResults === 'never' ? 'Your faculty has chosen not to publish scores for this exam.' : 'Your result will appear here once the exam ends for everyone.'}
            </p>
            <div className="mt-5 flex gap-6 text-[13px] text-muted-foreground"><span className="flex items-center gap-1.5"><Clock3 className="size-3.5" />{formatDuration(taken)}</span><span>{data.totalQuestions} questions</span>{data.set && <span>You wrote <b className="font-semibold text-foreground">Set {data.set}</b></span>}</div>
          </div>
        </Card>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-4">
            <Card className="p-4 sm:col-span-1">
              <p className="text-[13px] text-muted-foreground">Score</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{data.score}<span className="text-base font-normal text-muted-foreground"> / {data.maxScore}</span></p>
              <p className="mt-1 text-xs text-muted-foreground">{data.maxScore ? Math.round(((data.score ?? 0) / data.maxScore) * 100) : 0}%</p>
            </Card>
            <StatCard label="Correct MCQs" value={<span className="text-success">{data.correctCount}</span>} hint={`${data.wrongCount} wrong`} />
            <StatCard label="Coding marks" value={data.codingScore ?? 0} hint={data.codingPending ? `${data.codingPending} still being graded` : undefined} />
            <StatCard label="Time taken" value={formatDuration(taken)} />
          </div>
          {data.codingPending ? <Alert tone="info" className="mt-4 flex items-center gap-2"><Hourglass className="size-4" />Some coding answers are still being graded, so your score may go up.</Alert> : null}

          <Card className="mt-6">
            <CardHeader title="Answer review" />
            <div>
              {data.items?.map(item => (
                <div key={item.number} className="border-b border-border px-5 py-4 last:border-0">
                  {item.type === 'removed' ? <p className="text-sm text-muted-foreground">Q{item.number}. This question was removed.</p> : item.type === 'coding' ? (
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <p className="flex items-center gap-2 text-sm font-semibold"><Code2 className="size-4 text-violet" /><span className="font-mono text-xs font-normal text-subtle">Q{item.number}</span>{item.title}</p>
                        {item.marks == null ? <Badge tone="violet">{item.answer ? 'Being graded' : 'Not attempted'}</Badge> : <Badge tone="green">{item.marks} / {item.points}</Badge>}
                      </div>
                      {item.feedback && <p className="mt-2 rounded-md bg-muted px-3 py-2 text-[13px]"><span className="font-medium">Feedback:</span> {item.feedback}</p>}
                      {item.answer && (
                        <div className="mt-3 overflow-hidden rounded-md border border-border">
                          <div className="bg-[#252526] px-3 py-1 text-xs text-white/70">{languageLabel(item.answer.language)}</div>
                          <CodeEditor value={item.answer.code} language={item.answer.language} readOnly height={Math.min(360, Math.max(120, item.answer.code.split('\n').length * 20 + 30))} />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm leading-6"><span className="mr-2 font-mono text-xs text-subtle">Q{item.number}</span>{item.text}</p>
                        {item.selected == null ? <Badge><Minus className="size-3" />Skipped</Badge> : item.selected === item.correctIndex ? <Badge tone="green"><Check className="size-3" />Correct{item.marks != null && ` · +${item.marks}`}</Badge> : <Badge tone="red"><X className="size-3" />Wrong</Badge>}
                      </div>
                      <ul className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
                        {item.options.map((option, i) => (
                          <li key={i} className={cn('flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-[13px]', i === item.correctIndex ? 'border-success-border bg-success-soft text-success-ink' : i === item.selected ? 'border-danger-border bg-danger-soft text-danger-ink' : 'border-border text-muted-foreground')}>
                            <span className="font-mono text-xs font-semibold">{letter(i)}</span><span className="flex-1">{option}</span>{i === item.selected && <span className="text-[11px] font-semibold uppercase">Yours</span>}
                          </li>
                        ))}
                      </ul>
                      {item.explanation && <p className="mt-2 text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">Explanation:</span> {item.explanation}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

function SetTag({ set }: { set: string }) {
  return <span className="inline-flex items-center rounded-md border border-primary-border bg-primary-soft px-2 py-0.5 text-[13px] font-semibold text-primary">Set {set}</span>
}

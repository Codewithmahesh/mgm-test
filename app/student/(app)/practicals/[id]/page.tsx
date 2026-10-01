'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ArrowLeft, Check, Lock, Play } from 'lucide-react'
import { Badge, Card, PageHeader, PageLoader, Progress } from '@/components/ui/card'
import { Alert } from '@/components/ui/form'
import { api, errorMessage, relativeTime } from '@/lib/api'
import type { MyLevel } from '@/lib/practical-types'
import { cn } from '@/lib/utils'

type Data = { subject: { id: string; title: string; code: string; description: string; faculty: string }; experiments: MyLevel[] }

export default function PracticalLevelsPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<Data>(`/api/student/practicals/${id}`).then(setData).catch(err => setError(errorMessage(err))) }, [id])

  if (!data) return error ? <Alert>{error}</Alert> : <PageLoader />
  const solved = data.experiments.filter(e => e.status === 'solved').length

  return (
    <>
      <Link href="/student/practicals" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Practicals</Link>
      <PageHeader eyebrow={[data.subject.code, data.subject.faculty].filter(Boolean).join(' · ') || undefined} title={data.subject.title} description={data.subject.description || undefined} />
      <Card className="mb-4 p-4">
        <div className="mb-2 flex justify-between text-[13px]"><span className="font-medium">{solved} of {data.experiments.length} experiments solved</span><span className="text-muted-foreground">{data.experiments.length ? Math.round((solved / data.experiments.length) * 100) : 0}%</span></div>
        <Progress value={data.experiments.length ? (solved / data.experiments.length) * 100 : 0} tone="green" />
      </Card>
      <ol className="relative flex flex-col gap-3">
        {data.experiments.map(level => {
          const locked = level.status === 'locked'
          const body = (
            <Card className={cn('flex items-center gap-4 p-5 transition-colors', !locked && 'hover:border-primary-border', locked && 'opacity-60')}>
              <div className={cn('flex size-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold tabular-nums',
                level.status === 'solved' ? 'bg-success text-white' : level.status === 'open' ? 'bg-primary text-primary-foreground' : 'bg-muted text-subtle')}>
                {level.status === 'solved' ? <Check className="size-5" /> : locked ? <Lock className="size-4" /> : level.order}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Experiment {level.order}</div>
                <div className="truncate text-base font-semibold">{locked ? 'Locked: solve the previous experiment first' : level.title}</div>
                {!locked && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                    {level.topic && <Badge>{level.topic}</Badge>}
                    {level.status === 'solved' && <span>Solved {relativeTime(level.solvedAt)}</span>}
                    {level.hiddenPassed != null && level.hiddenTotal > 0 && <span>· hidden tests {level.hiddenPassed}/{level.hiddenTotal}</span>}
                    {level.status === 'open' && level.attempts > 0 && <span>{level.attempts} attempt{level.attempts === 1 ? '' : 's'} so far</span>}
                    {level.practiceSolved > 0 && <span>· {level.practiceSolved} practice solved</span>}
                  </div>
                )}
              </div>
              {level.status === 'open' && <span className="inline-flex items-center gap-1 text-[13px] font-medium text-primary"><Play className="size-4" />{level.attempts ? 'Continue' : 'Start'}</span>}
              {level.status === 'solved' && <span className="text-[13px] text-muted-foreground">Practice more</span>}
            </Card>
          )
          return <li key={level.id}>{locked ? body : <Link href={`/student/practicals/${id}/${level.id}`}>{body}</Link>}</li>
        })}
      </ol>
    </>
  )
}

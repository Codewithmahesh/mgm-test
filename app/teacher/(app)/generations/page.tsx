'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Clock3, DoorOpen, Hourglass, Sparkles, Trash2 } from 'lucide-react'
import { AddQuestions } from '@/components/add-questions'
import { Button } from '@/components/ui/button'
import { Badge, Card, EmptyState, PageHeader, PageLoader } from '@/components/ui/card'
import { Alert } from '@/components/ui/form'
import { useFeedback } from '@/components/ui/overlay'
import { api, errorMessage, relativeTime } from '@/lib/api'
import { cn } from '@/lib/utils'

type Job = {
  id: string
  title: string
  status: 'running' | 'ready' | 'failed'
  background: boolean
  room: { id: string; title: string; code: string } | null
  requested: { mcq: number; tf?: number; coding: number }
  sets: string[]
  progress: { total: number; done: number; failed: number; running: number; waiting: number }
  nextRetryAt: string | null
  lastError: string
  error: string
  resultCount: number
  createdAt: string
  finishedAt: string | null
}

/** AI generations: running in the background, ready to review, or failed. */
function Generations() {
  const { toast, confirm } = useFeedback()
  const router = useRouter()
  const search = useSearchParams()
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [error, setError] = useState('')
  const [review, setReview] = useState<Job | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  const load = useCallback(() => api<{ jobs: Job[] }>('/api/generation-jobs').then(data => { setJobs(data.jobs); setError('') }).catch(err => setError(errorMessage(err))), [])
  useEffect(() => { void load() }, [load])
  // Keep progress fresh while anything is still running.
  const anyRunning = jobs?.some(job => job.status === 'running')
  useEffect(() => {
    if (!anyRunning) return
    const timer = setInterval(() => void load(), 5000)
    return () => clearInterval(timer)
  }, [anyRunning, load])

  // Opened from the "ready to review" email.
  const reviewId = search.get('review')
  useEffect(() => {
    if (!reviewId || !jobs) return
    const job = jobs.find(j => j.id === reviewId)
    if (job?.status === 'ready') setReview(job)
    else if (!job) toast('Those questions were already reviewed or dismissed.', 'info')
    router.replace('/teacher/generations')
  }, [reviewId, jobs, router, toast])

  async function remove(job: Job) {
    const running = job.status === 'running'
    if (!(await confirm({
      title: running ? 'Cancel this generation?' : job.status === 'ready' ? 'Discard these questions?' : 'Dismiss this generation?',
      description: running ? 'The AI stops working on it and nothing is saved.' : job.status === 'ready' ? `The ${job.resultCount} generated questions will be deleted without being added anywhere.` : undefined,
      confirmLabel: running ? 'Cancel generation' : job.status === 'ready' ? 'Discard' : 'Dismiss',
      cancelLabel: 'Keep',
      tone: 'danger',
    }))) return
    setRemoving(job.id)
    try {
      await api(`/api/generation-jobs/${job.id}`, { method: 'DELETE' })
      setJobs(list => list?.filter(j => j.id !== job.id) ?? null)
    } catch (err) { toast(errorMessage(err), 'error') } finally { setRemoving(null) }
  }

  const ready = jobs?.filter(j => j.status === 'ready') ?? []
  return (
    <>
      <PageHeader title="AI generations" description="Questions the AI is writing for you in the background, and batches waiting for your review. Nothing is added to a room until you review and save it." />
      {error && <Alert className="mb-4">{error}</Alert>}
      {!jobs ? <PageLoader /> : !jobs.length ? (
        <Card><EmptyState icon={Sparkles} title="Nothing here right now" description="When you generate questions with AI in the background, they show up here and we email you once they're ready to review." /></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {ready.length > 0 && <p className="text-[13px] text-muted-foreground"><b className="font-semibold text-foreground">{ready.length}</b> batch{ready.length === 1 ? '' : 'es'} ready to review.</p>}
          {jobs.map(job => <JobCard key={job.id} job={job} removing={removing === job.id} onReview={() => setReview(job)} onRemove={() => remove(job)} />)}
        </div>
      )}
      <AddQuestions open={Boolean(review)} reviewJobId={review?.id ?? null} roomId={review?.room?.id ?? null} onClose={() => setReview(null)}
        onSaved={() => { setJobs(list => list?.filter(j => j.id !== review?.id) ?? null); setReview(null) }} />
    </>
  )
}

function JobCard({ job, removing, onReview, onRemove }: { job: Job; removing: boolean; onReview: () => void; onRemove: () => void }) {
  const requested = [job.requested.mcq ? `${job.requested.mcq} MCQs` : '', job.requested.tf ? `${job.requested.tf} True/False` : '', job.requested.coding ? `${job.requested.coding} coding` : ''].filter(Boolean).join(' + ')
  const { total, done, failed } = job.progress
  const percent = total ? Math.round(((done + failed) / total) * 100) : 0
  const waiting = job.status === 'running' && job.nextRetryAt && !job.progress.running
  const status = job.status === 'ready' ? { icon: CheckCircle2, tone: 'green' as const, label: 'Ready to review' }
    : job.status === 'failed' ? { icon: AlertTriangle, tone: 'red' as const, label: 'Failed' }
    : waiting ? { icon: Hourglass, tone: 'amber' as const, label: 'Waiting for the AI' }
    : { icon: Sparkles, tone: 'blue' as const, label: 'Generating' }

  return (
    <Card className={cn('p-4 sm:p-5', job.status === 'ready' && 'border-success-border')}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}><status.icon className={cn('size-3', job.status === 'running' && !waiting && 'animate-pulse')} />{status.label}</Badge>
            <span className="text-xs text-muted-foreground">{relativeTime(job.createdAt)}</span>
          </div>
          <p className="mt-2 truncate text-[15px] font-semibold">{job.title || 'AI questions'}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
            <span>{job.status === 'ready' ? `${job.resultCount} questions generated` : requested}{job.sets.length ? ` · sets ${job.sets[0]}–${job.sets.at(-1)}` : ''}</span>
            {job.room ? <Link href={`/teacher/rooms/${job.room.id}`} className="inline-flex items-center gap-1 hover:text-foreground"><DoorOpen className="size-3.5" />{job.room.title}</Link> : <span>For your question bank</span>}
          </p>
          {job.status === 'running' && (
            <div className="mt-3 max-w-md">
              <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${Math.max(4, percent)}%` }} />
                {!waiting && <div className="absolute inset-y-0 left-0 w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent" />}
              </div>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                {waiting
                  ? <><Clock3 className="size-3.5" />The AI is busy; trying again {relativeTime(job.nextRetryAt)}. We&apos;ll email you when it&apos;s done.</>
                  : <>{total > 1 ? `${done} of ${total} parts done` : 'Working on it'}{job.background ? " · we'll email you when it's done" : ''}</>}
              </p>
            </div>
          )}
          {job.error && <p className={cn('mt-2 text-[13px]', job.status === 'failed' ? 'text-danger' : 'text-warning-ink')}>{job.error}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          {job.status === 'ready' && <Button onClick={onReview}><CheckCircle2 />Review and add</Button>}
          <Button variant="outline" loading={removing} onClick={onRemove}><Trash2 />{job.status === 'running' ? 'Cancel' : job.status === 'ready' ? 'Discard' : 'Dismiss'}</Button>
        </div>
      </div>
    </Card>
  )
}

export default function GenerationsPage() {
  return <Suspense><Generations /></Suspense>
}

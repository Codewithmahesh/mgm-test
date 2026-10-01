'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowRight, FlaskConical, Trophy } from 'lucide-react'
import { Badge, Card, EmptyState, PageHeader, PageLoader, Progress } from '@/components/ui/card'
import { Alert } from '@/components/ui/form'
import { api, errorMessage } from '@/lib/api'
import type { MyPractical } from '@/lib/practical-types'

export default function MyPracticalsPage() {
  const [subjects, setSubjects] = useState<MyPractical[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<{ subjects: MyPractical[] }>('/api/student/practicals').then(d => setSubjects(d.subjects)).catch(err => setError(errorMessage(err))) }, [])

  return (
    <>
      <PageHeader title="Practicals" description="Solve each experiment to unlock the next. Passing every sample test completes a level." />
      {error && <Alert className="mb-4">{error}</Alert>}
      {!subjects ? <PageLoader /> : subjects.length === 0 ? (
        <Card><EmptyState icon={FlaskConical} title="No practicals yet" description="Your faculty hasn't added a practical for your class yet." /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {subjects.map(subject => {
            const done = subject.experiments > 0 && subject.solved === subject.experiments
            return (
              <Link key={subject.id} href={`/student/practicals/${subject.id}`} className="group">
                <Card className="flex h-full flex-col gap-3 p-4 transition-colors group-hover:border-primary-border">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold group-hover:text-primary">{subject.title}</div>
                      <div className="text-xs text-muted-foreground">{[subject.code, subject.faculty].filter(Boolean).join(' · ')}</div>
                    </div>
                    {done ? <Badge tone="green"><Trophy className="size-3" />Complete</Badge> : <Badge tone="violet">{subject.solved}/{subject.experiments}</Badge>}
                  </div>
                  <Progress value={subject.experiments ? (subject.solved / subject.experiments) * 100 : 0} tone="green" />
                  <div className="mt-auto flex items-center justify-between text-[13px]">
                    <span className="truncate text-muted-foreground">{subject.next ? `Next: ${subject.next.order}. ${subject.next.title}` : subject.experiments ? 'All experiments solved' : 'No experiments yet'}</span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                  </div>
                  {subject.practiceSolved > 0 && <div className="text-xs text-muted-foreground">{subject.practiceSolved} practice problem{subject.practiceSolved === 1 ? '' : 's'} solved</div>}
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </>
  )
}

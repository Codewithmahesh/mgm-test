'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { FlaskConical, Plus } from 'lucide-react'
import { PracticalSubjectDialog } from '@/components/practical-form'
import { Button } from '@/components/ui/button'
import { Badge, Card, EmptyState, PageHeader, PageLoader, Progress } from '@/components/ui/card'
import { Alert } from '@/components/ui/form'
import { api, errorMessage } from '@/lib/api'
import type { PracticalSubject } from '@/lib/practical-types'

export default function PracticalsPage() {
  const [subjects, setSubjects] = useState<PracticalSubject[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  useEffect(() => { api<{ subjects: PracticalSubject[] }>('/api/practicals').then(d => setSubjects(d.subjects)).catch(err => setError(errorMessage(err))) }, [])

  return (
    <>
      <PageHeader title="Practicals" description="Lab subjects with experiments students solve level by level. Track who has solved what." actions={<Button onClick={() => setCreating(true)}><Plus />New practical</Button>} />
      {error && <Alert className="mb-4">{error}</Alert>}
      {!subjects ? <PageLoader /> : subjects.length === 0 ? (
        <Card><EmptyState icon={FlaskConical} title="No practicals yet" description="Create a practical for a lab subject, add its experiments in order, and choose the classes that take it." action={<Button onClick={() => setCreating(true)}><Plus />New practical</Button>} /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {subjects.map(subject => (
            <Link key={subject.id} href={`/teacher/practicals/${subject.id}`} className="group">
              <Card className="flex h-full flex-col gap-3 p-4 transition-colors group-hover:border-primary-border">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold group-hover:text-primary">{subject.title}</div>
                    {subject.code && <div className="font-mono text-xs font-semibold tracking-wide text-muted-foreground">{subject.code}</div>}
                  </div>
                  <Badge tone="violet">{subject.experiments} experiment{subject.experiments === 1 ? '' : 's'}</Badge>
                </div>
                <div className="flex flex-wrap gap-1">{subject.classLabels.map(label => <Badge key={label}>{label}</Badge>)}</div>
                <div className="mt-auto">
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>{subject.students} students</span><span>{subject.completionPercent == null ? '—' : `${subject.completionPercent}% solved`}</span></div>
                  <Progress value={subject.completionPercent ?? 0} tone="green" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <PracticalSubjectDialog open={creating} initial={null} onClose={() => setCreating(false)} onSaved={subject => { window.location.href = `/teacher/practicals/${subject.id}` }} />
    </>
  )
}

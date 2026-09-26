'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { DoorOpen, Plus, Search } from 'lucide-react'
import { CopyCode, RoomStatusBadge } from '@/components/common'
import { buttonVariants } from '@/components/ui/button'
import { Card, EmptyState, PageHeader, PageLoader } from '@/components/ui/card'
import { Alert, Input } from '@/components/ui/form'
import { Tabs } from '@/components/ui/overlay'
import { api, errorMessage, formatDate, type Room, type RoomStatus } from '@/lib/api'

export default function RoomsPage() {
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'all' | RoomStatus>('all')
  const [query, setQuery] = useState('')
  useEffect(() => { api<{ rooms: Room[] }>('/api/rooms').then(data => setRooms(data.rooms)).catch(err => setError(errorMessage(err))) }, [])

  const visible = useMemo(() => (rooms ?? []).filter(room => (tab === 'all' || room.status === tab) && (!query || `${room.title} ${room.code}`.toLowerCase().includes(query.toLowerCase()))), [rooms, tab, query])
  const count = (status: RoomStatus) => rooms?.filter(room => room.status === status).length ?? 0

  return (
    <>
      <PageHeader title="Exam rooms" description="Each room is one exam with its own code, timer and question pool." actions={<Link href="/teacher/rooms/new" className={buttonVariants()}><Plus />New exam room</Link>} />
      {error && <Alert className="mb-4">{error}</Alert>}
      {!rooms ? <PageLoader /> : (
        <Card>
          <div className="flex flex-col gap-3 border-b border-border px-4 pt-2 sm:flex-row sm:items-end sm:justify-between">
            <Tabs className="border-b-0" value={tab} onChange={setTab} tabs={[{ value: 'all', label: 'All', count: rooms.length }, { value: 'open', label: 'Live', count: count('open') }, { value: 'draft', label: 'Draft', count: count('draft') }, { value: 'closed', label: 'Ended', count: count('closed') }]} />
            <div className="relative mb-2 sm:w-64"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" /><Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or code" className="pl-9" /></div>
          </div>
          {visible.length === 0 ? (
            <EmptyState icon={DoorOpen} title={rooms.length ? 'No rooms match' : 'No exam rooms yet'} description={rooms.length ? 'Try a different filter or search.' : 'Create your first room to get started.'} action={!rooms.length && <Link href="/teacher/rooms/new" className={buttonVariants()}><Plus />New exam room</Link>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base min-w-[860px]">
                <thead><tr><th>Room</th><th>Code</th><th>Paper</th><th>Pool</th><th>Submitted</th><th>Average</th><th>Status</th></tr></thead>
                <tbody>
                  {visible.map(room => (
                    <tr key={room.id}>
                      <td><Link href={`/teacher/rooms/${room.id}`} className="font-medium hover:text-primary">{room.title}</Link><div className="text-xs text-muted-foreground">Created {formatDate(room.createdAt)}</div></td>
                      <td><CopyCode code={room.code} /></td>
                      <td className="text-[13px] text-muted-foreground">{room.questionsPerStudent} MCQ{room.codingQuestions ? ` + ${room.codingQuestions} coding` : ''}<div>{room.durationMinutes} min</div></td>
                      <td className="text-[13px] tabular-nums text-muted-foreground">{room.mcqPoolSize} MCQ{room.codingPoolSize ? ` · ${room.codingPoolSize} coding` : ''}</td>
                      <td className="tabular-nums">{room.submitted}<span className="text-muted-foreground"> / {room.joined}</span>{room.pendingReview > 0 && <div className="text-xs text-warning">{room.pendingReview} to grade</div>}</td>
                      <td className="tabular-nums">{room.averagePercent == null ? <span className="text-muted-foreground">—</span> : `${room.averagePercent}%`}</td>
                      <td><RoomStatusBadge status={room.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  )
}

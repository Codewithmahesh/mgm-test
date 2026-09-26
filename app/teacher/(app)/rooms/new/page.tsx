'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { RoomForm, emptyRoomValues, valuesToPayload } from '@/components/room-form'
import { PageHeader } from '@/components/ui/card'
import { api, type Room } from '@/lib/api'

export default function NewRoomPage() {
  const router = useRouter()
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/teacher/rooms" className="hover:text-foreground">Exam rooms</Link>}
        title="New exam room"
        description="Set up the exam first. Next you'll add questions from a CSV, a PDF, your notes or the question bank."
      />
      <RoomForm
        initial={emptyRoomValues()}
        submitLabel="Create room and add questions"
        onSubmit={async values => {
          const data = await api<{ room: Room }>('/api/rooms', { body: { ...valuesToPayload(values), status: 'draft' } })
          router.push(`/teacher/rooms/${data.room.id}?tab=questions&new=1`)
        }}
      />
    </>
  )
}

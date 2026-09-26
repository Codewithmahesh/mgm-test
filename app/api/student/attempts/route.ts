import { NextResponse } from 'next/server'
import { handler, requireStudent } from '@/lib/auth'
import { resultsVisible, submitIfExpired } from '@/lib/exams'
import { Attempt, ExamRoom } from '@/lib/models'

/** GET /api/student/attempts — the signed-in student's exams, newest first. */
export const GET = handler(async () => {
  const student = await requireStudent()
  const attempts = await Attempt.find({ $or: [{ student: student._id }, { studentEmail: student.officialEmail }] }).sort({ createdAt: -1 })
  for (const attempt of attempts) await submitIfExpired(attempt)
  const rooms = new Map((await ExamRoom.find({ _id: { $in: attempts.map(a => a.room) } }).select('title code status showResults').lean()).map(r => [String(r._id), r]))

  return NextResponse.json({
    attempts: attempts.map(a => {
      const room = rooms.get(String(a.room))
      const visible = room ? resultsVisible(room, a) : false
      return {
        id: String(a._id),
        room: room ? { title: room.title, code: room.code, status: room.status } : { title: 'Deleted exam', code: '', status: 'closed' },
        status: a.status,
        startedAt: a.startedAt,
        endsAt: a.endsAt,
        submittedAt: a.submittedAt ?? null,
        totalQuestions: a.questions.length,
        resultVisible: visible,
        score: visible ? a.score : null,
        maxScore: visible ? a.maxScore : null,
        codingPending: visible ? a.codingPending ?? 0 : null,
      }
    }),
  })
})

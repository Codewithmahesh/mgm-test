import { NextResponse } from 'next/server'
import { HttpError, handler, rateLimit, requireStudent } from '@/lib/auth'
import { dealQuestions, gradeAttempt } from '@/lib/exams'
import { Attempt } from '@/lib/models'
import { findRoomByCode, startBlocker } from '@/lib/student-exam'

type Context = { params: Promise<{ code: string }> }

/** POST /api/student/rooms/:code/start — creates the student's paper and starts the timer (or resumes it). */
export const POST = handler(async (_request: Request, context: Context) => {
  const student = await requireStudent()
  await rateLimit(`start:student:${student._id}`, 30, 10 * 60)
  const room = await findRoomByCode((await context.params).code)
  const email = student.officialEmail!

  const existing = await Attempt.findOne({ room: room._id, studentEmail: email }).select('status')
  if (existing) {
    if (existing.status === 'submitted') throw new HttpError(409, 'You have already submitted this exam.')
    return NextResponse.json({ attemptId: String(existing._id), resumed: true })
  }
  const blocker = startBlocker(room, student)
  if (blocker) throw new HttpError(403, blocker)

  const questions = await dealQuestions(room)
  if (!questions.length) throw new HttpError(409, "This exam doesn't have any questions yet. Let your faculty know.")

  const startedAt = new Date()
  try {
    const attempt = await Attempt.create({
      room: room._id,
      student: student._id,
      studentEmail: email,
      studentName: student.name,
      rollNumber: student.rollNumber ?? '',
      questions,
      answers: questions.map(() => null),
      startedAt,
      endsAt: new Date(startedAt.getTime() + room.durationMinutes * 60_000),
      marksPerQuestion: room.marksPerQuestion,
      negativeMarks: room.negativeMarks ?? 0,
      lastSeenAt: startedAt,
    })
    // Fills in the maximum score now, so faculty see "0 / 20" rather than "0 / 0" while the student writes.
    await gradeAttempt(attempt, room.codingMarks ?? 10)
    await attempt.save()
    return NextResponse.json({ attemptId: String(attempt._id), resumed: false }, { status: 201 })
  } catch (error) {
    // Double-click or two tabs: the unique (room, email) index caught a duplicate; resume the first one.
    if ((error as { code?: number }).code === 11000) {
      const attempt = await Attempt.findOne({ room: room._id, studentEmail: email }).select('_id')
      if (attempt) return NextResponse.json({ attemptId: String(attempt._id), resumed: true })
    }
    throw error
  }
})

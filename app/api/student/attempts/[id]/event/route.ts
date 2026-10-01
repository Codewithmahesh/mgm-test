import { NextResponse } from 'next/server'
import { HttpError, handler, readJson, requireStudent } from '@/lib/auth'
import { submitIfExpired } from '@/lib/exams'
import { isIntegrityEvent, violationCount, normalizeFlags } from '@/lib/integrity'
import { Attempt, ExamRoom } from '@/lib/models'
import { assertSession, recordEvent } from '@/lib/proctoring'
import { findOwnAttempt } from '@/lib/student-exam'

/** Submitting grades the paper, which can run the students' code; give it time. */
export const maxDuration = 300

type Context = { params: Promise<{ id: string }> }

/**
 * POST /api/student/attempts/:id/event { type, detail? }
 * type 'heartbeat' keeps the attempt alive and returns the latest status and end time
 * (so faculty time extensions and early endings reach the student). Any other type is a
 * proctoring signal (see lib/integrity.ts) shown to the faculty.
 */
export const POST = handler(async (request: Request, context: Context) => {
  const student = await requireStudent()
  let attempt = await submitIfExpired(await findOwnAttempt(student, (await context.params).id))
  const body = await readJson(request)

  if (attempt.status === 'in_progress') {
    assertSession(attempt, request)
    if (body.type === 'heartbeat') {
      await Attempt.updateOne({ _id: attempt._id }, { $set: { lastSeenAt: new Date() } })
    } else if (isIntegrityEvent(body.type) && !['multiple_sessions', 'ip_change'].includes(body.type)) {
      attempt = (await recordEvent(String(attempt._id), body.type, String(body.detail ?? ''))) ?? attempt
    } else {
      throw new HttpError(400, 'Unknown event type.')
    }
  }

  const room = await ExamRoom.findById(attempt.room).select('maxViolations').lean()
  return NextResponse.json({
    status: attempt.status,
    endsAt: attempt.endsAt.toISOString(),
    serverNow: new Date().toISOString(),
    autoSubmitReason: attempt.autoSubmitReason ?? '',
    violations: violationCount(normalizeFlags(attempt.flags, attempt.tabSwitches)),
    maxViolations: room?.maxViolations ?? 0,
    flags: normalizeFlags(attempt.flags, attempt.tabSwitches),
  })
})

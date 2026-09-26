import { NextResponse } from 'next/server'
import { HttpError, handler, rateLimit, readJson, requireStudent } from '@/lib/auth'
import { submitIfExpired } from '@/lib/exams'
import { claimSession } from '@/lib/proctoring'
import { findOwnAttempt } from '@/lib/student-exam'

type Context = { params: Promise<{ id: string }> }

/**
 * POST /api/student/attempts/:id/session — makes this tab the active one for the exam and
 * returns its session key. Any other open tab or device is locked out.
 */
export const POST = handler(async (request: Request, context: Context) => {
  const student = await requireStudent()
  const attempt = await submitIfExpired(await findOwnAttempt(student, (await context.params).id))
  if (attempt.status !== 'in_progress') throw new HttpError(409, 'This exam has already been submitted.', 'submitted')
  await rateLimit(`session:${attempt._id}`, 200, 60 * 60)
  const body = await readJson(request).catch(() => ({} as Record<string, unknown>))
  const sessionKey = await claimSession(attempt, request, String(body.tabId ?? ''))
  return NextResponse.json({ sessionKey })
})

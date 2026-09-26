import { NextResponse } from 'next/server'
import { handler, readJson, requireStudent } from '@/lib/auth'
import { isAcceptingAnswers, submitAttempt } from '@/lib/exams'
import { applyAnswers, findOwnAttempt } from '@/lib/student-exam'
import { assertSession } from '@/lib/proctoring'

type Context = { params: Promise<{ id: string }> }

/** POST /api/student/attempts/:id/submit { answers? } — saves any last answers, grades and locks the attempt. */
export const POST = handler(async (request: Request, context: Context) => {
  const student = await requireStudent()
  const attempt = await findOwnAttempt(student, (await context.params).id)
  if (attempt.status === 'in_progress') assertSession(attempt, request)
  const body = await readJson<{ answers?: Record<string, unknown> }>(request).catch(() => ({} as { answers?: Record<string, unknown> }))

  if (isAcceptingAnswers(attempt) && body.answers && typeof body.answers === 'object') await applyAnswers(attempt, body.answers, false)
  await submitAttempt(attempt)
  return NextResponse.json({ ok: true, submittedAt: attempt.submittedAt })
})

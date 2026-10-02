import { NextResponse } from 'next/server'
import { handler, rateLimit, requireStudent } from '@/lib/auth'
import { buildPracticalReport } from '@/lib/practical-report'
import { findStudentSubject } from '@/lib/practicals'

export const maxDuration = 300

type Context = { params: Promise<{ id: string }> }

/** GET /api/student/practicals/:id/report — the whole practical journal for the PDF, locked experiments included with their aims. */
export const GET = handler(async (_request: Request, context: Context) => {
  const student = await requireStudent()
  const subject = await findStudentSubject(student, (await context.params).id)
  await rateLimit(`practical-report:${student._id}`, 20, 60)
  const report = await buildPracticalReport({ subject, student, hideLocked: true })
  return NextResponse.json({ report })
})

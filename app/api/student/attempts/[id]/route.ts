import { NextResponse } from 'next/server'
import { HttpError, handler, readJson, requireStudent } from '@/lib/auth'
import { isAcceptingAnswers, submitIfExpired } from '@/lib/exams'
import { ExamRoom, Question } from '@/lib/models'
import { applyAnswers, findOwnAttempt } from '@/lib/student-exam'
import { assertSession, integrityOf } from '@/lib/proctoring'

type Context = { params: Promise<{ id: string }> }

/** GET /api/student/attempts/:id — the student's paper (no answers or solutions), saved progress and timer. */
export const GET = handler(async (_request: Request, context: Context) => {
  const student = await requireStudent()
  const attempt = await submitIfExpired(await findOwnAttempt(student, (await context.params).id))
  const room = await ExamRoom.findById(attempt.room).select('title code marksPerQuestion negativeMarks codingMarks instructions requireFullscreen blockCopyPaste maxViolations').lean()

  const base = {
    id: String(attempt._id),
    status: attempt.status,
    student: { name: student.name, email: student.officialEmail, rollNumber: student.rollNumber ?? '' },
    room: { title: room?.title ?? 'Exam', code: room?.code ?? '', instructions: room?.instructions ?? '', marksPerQuestion: room?.marksPerQuestion ?? 1, negativeMarks: room?.negativeMarks ?? 0 },
    proctoring: { requireFullscreen: room?.requireFullscreen ?? true, blockCopyPaste: room?.blockCopyPaste ?? true, maxViolations: room?.maxViolations ?? 0, ...integrityOf(attempt) },
    autoSubmitReason: attempt.autoSubmitReason ?? '',
    // The question set is disclosed only after the exam is submitted.
    set: attempt.status === 'submitted' ? attempt.setLabel ?? '' : '',
    serverNow: new Date().toISOString(),
    startedAt: attempt.startedAt.toISOString(),
    endsAt: attempt.endsAt.toISOString(),
  }
  if (attempt.status === 'submitted') return NextResponse.json(base)

  const docs = await Question.find({ _id: { $in: attempt.questions } }).select('type text options topic bloom title inputFormat outputFormat constraints samples points language starterCode imageUrl').lean()
  const byId = new Map(docs.map(q => [String(q._id), q]))
  const questions = attempt.questions.map((id, index) => {
    const q = byId.get(String(id))
    if (!q) return { number: index + 1, type: 'mcq' as const, text: 'This question was removed by your faculty. You can skip it.', options: [], topic: '', imageUrl: '' }
    if (q.type === 'coding') {
      return {
        number: index + 1, type: 'coding' as const, title: q.title || `Problem ${index + 1}`, text: q.text, imageUrl: q.imageUrl ?? '', topic: q.topic ?? '',
        inputFormat: q.inputFormat ?? '', outputFormat: q.outputFormat ?? '', constraints: q.constraints ?? '',
        samples: (q.samples ?? []).map(s => ({ input: s.input, output: s.output, explanation: s.explanation ?? '' })),
        points: q.points ?? room?.codingMarks ?? 10, language: q.language || '', starterCode: q.starterCode ?? '',
      }
    }
    return { number: index + 1, type: q.type, text: q.text, imageUrl: q.imageUrl ?? '', options: q.options, topic: q.topic ?? '', marks: attempt.questionMarks?.[index] ?? attempt.marksPerQuestion }
  })
  return NextResponse.json({ ...base, questions, answers: attempt.answers, flagged: attempt.flagged, tabSwitches: attempt.tabSwitches ?? 0 })
})

/**
 * PATCH /api/student/attempts/:id { answers?: { [number]: optionIndex | { language, code } | null }, flagged?: number[] }
 * Autosaves progress. Rejected once time is up.
 */
export const PATCH = handler(async (request: Request, context: Context) => {
  const student = await requireStudent()
  const attempt = await submitIfExpired(await findOwnAttempt(student, (await context.params).id))
  if (!isAcceptingAnswers(attempt)) throw new HttpError(409, 'This exam has ended. Your answers were submitted.', 'submitted')
  assertSession(attempt, request)

  const body = await readJson<{ answers?: Record<string, unknown>; flagged?: unknown }>(request)
  if (body.answers && typeof body.answers === 'object') await applyAnswers(attempt, body.answers)
  if (Array.isArray(body.flagged)) {
    attempt.flagged = [...new Set(body.flagged.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= attempt.questions.length))]
  }
  attempt.lastSeenAt = new Date()
  await attempt.save()
  return NextResponse.json({ ok: true, savedAt: attempt.lastSeenAt.toISOString() })
})

import { NextResponse } from 'next/server'
import { HttpError, handler, readJson, requireTeacher } from '@/lib/auth'
import { codingAnswer, gradeAttempt, submitAttempt, submitIfExpired } from '@/lib/exams'
import { Attempt, Question, Student, classLabel, isObjectId } from '@/lib/models'
import { findTeacherRoom } from '@/lib/rooms'
import { normalizeFlags, riskOf, violationCount } from '@/lib/integrity'

type Context = { params: Promise<{ id: string; attemptId: string }> }

async function load(context: Context) {
  const teacher = await requireTeacher()
  const { id, attemptId } = await context.params
  const room = await findTeacherRoom(teacher._id, id)
  if (!isObjectId(attemptId)) throw new HttpError(404, 'Attempt not found.')
  const attempt = await Attempt.findOne({ _id: attemptId, room: room._id })
  if (!attempt) throw new HttpError(404, 'Attempt not found.')
  return { room, attempt }
}

async function detail(room: Awaited<ReturnType<typeof load>>['room'], attempt: Awaited<ReturnType<typeof load>>['attempt']) {
  const [questions, student] = await Promise.all([
    Question.find({ _id: { $in: attempt.questions } }).lean(),
    attempt.student ? Student.findById(attempt.student).populate('classroom').select('name rollNumber prn classroom officialEmail').lean() : null,
  ])
  const byId = new Map(questions.map(q => [String(q._id), q]))
  const marks = new Map(attempt.codingMarks.map(m => [String(m.question), m]))
  return {
    room: { id: String(room._id), title: room.title, code: room.code, status: room.status, marksPerQuestion: room.marksPerQuestion, negativeMarks: room.negativeMarks ?? 0, codingMarks: room.codingMarks ?? 10, maxViolations: room.maxViolations ?? 0 },
    integrity: (() => {
      const flags = normalizeFlags(attempt.flags, attempt.tabSwitches)
      return {
        flags,
        violations: violationCount(flags),
        ...riskOf(flags),
        events: (attempt.events ?? []).map(e => ({ type: e.type, at: e.at, detail: e.detail ?? '' })).reverse(),
        ipAddresses: attempt.ipAddresses ?? [],
        userAgent: attempt.userAgent ?? '',
      }
    })(),
    attempt: {
      id: String(attempt._id),
      studentName: student?.name || attempt.studentName || attempt.studentEmail,
      studentEmail: attempt.studentEmail,
      rollNumber: student?.rollNumber || attempt.rollNumber || '',
      prn: student?.prn ?? '',
      className: classLabel(student?.classroom as { class?: string; branch?: string; division?: string } | undefined),
      set: attempt.setLabel ?? '',
      status: attempt.status,
      autoSubmitted: attempt.autoSubmitted ?? false,
      autoSubmitReason: attempt.autoSubmitReason ?? '',
      startedAt: attempt.startedAt,
      endsAt: attempt.endsAt,
      submittedAt: attempt.submittedAt ?? null,
      tabSwitches: attempt.tabSwitches ?? 0,
      mcqScore: attempt.mcqScore ?? 0,
      codingScore: attempt.codingScore ?? 0,
      codingPending: attempt.codingPending ?? 0,
      correctCount: attempt.correctCount,
      wrongCount: attempt.wrongCount ?? 0,
      score: attempt.score,
      maxScore: attempt.maxScore,
    },
    items: attempt.questions.map((id, index) => {
      const q = byId.get(String(id))
      const answer = attempt.answers[index]
      if (!q) return { index, questionId: String(id), type: 'removed' as const, text: 'This question was deleted.' }
      if (q.type === 'coding') {
        const mark = marks.get(String(id))
        return {
          index, questionId: String(id), type: 'coding' as const, title: q.title, text: q.text, imageUrl: q.imageUrl ?? '', points: q.points ?? room.codingMarks ?? 10,
          samples: q.samples, answer: codingAnswer(answer), marks: mark?.marks ?? null, feedback: mark?.feedback ?? '',
        }
      }
      return { index, questionId: String(id), type: q.type, text: q.text, imageUrl: q.imageUrl ?? '', options: q.options, correctIndex: q.correctIndex, selected: typeof answer === 'number' ? answer : null, explanation: q.explanation, bloom: q.bloom ?? null, marks: attempt.questionMarks?.[index] ?? attempt.marksPerQuestion }
    }),
  }
}

/** GET — one student's paper with their answers, the correct answers and their code. */
export const GET = handler(async (_request: Request, context: Context) => {
  const { room, attempt } = await load(context)
  await submitIfExpired(attempt)
  return NextResponse.json(await detail(room, attempt))
})

/**
 * PATCH { marks: [{ questionId, marks, feedback }] } — grade coding answers.
 * PATCH { action: 'submit' } — force-submit a student who is still writing.
 * PATCH { action: 'reopen', minutes } — let a submitted student continue (e.g. after a wrongful
 *   auto-submit or a crash) for the given number of minutes. Their flags are kept.
 */
export const PATCH = handler(async (request: Request, context: Context) => {
  const { room, attempt } = await load(context)
  const body = await readJson(request)

  if (body.action === 'submit') {
    await submitAttempt(attempt, { auto: true, reason: 'faculty' })
    return NextResponse.json(await detail(room, attempt))
  }
  if (body.action === 'reopen') {
    if (room.status === 'closed') throw new HttpError(409, 'This exam has ended, so students can no longer be given more time. Reopen the room first if this student really needs to continue.')
    const minutes = Number(body.minutes)
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 300) throw new HttpError(400, 'Choose between 1 and 300 minutes.')
    attempt.status = 'in_progress'
    attempt.endsAt = new Date(Date.now() + minutes * 60_000)
    attempt.submittedAt = undefined
    attempt.autoSubmitted = false
    attempt.autoSubmitReason = ''
    attempt.sessionKey = ''
    attempt.sessionTab = ''
    await attempt.save()
    return NextResponse.json(await detail(room, attempt))
  }

  const updates = Array.isArray(body.marks) ? body.marks : []
  if (!updates.length) throw new HttpError(400, 'Nothing to update.')
  const coding = await Question.find({ _id: { $in: attempt.questions }, type: 'coding' }).select('points').lean()
  const pointsById = new Map(coding.map(q => [String(q._id), q.points ?? room.codingMarks ?? 10]))

  for (const update of updates as Record<string, unknown>[]) {
    const questionId = String(update.questionId ?? '')
    if (!pointsById.has(questionId)) throw new HttpError(400, 'That question is not a coding problem in this paper.')
    const existing = attempt.codingMarks.find(m => String(m.question) === questionId)
    if (update.marks === null || update.marks === '') {
      attempt.codingMarks = attempt.codingMarks.filter(m => String(m.question) !== questionId) as typeof attempt.codingMarks
      continue
    }
    const value = Number(update.marks)
    const max = pointsById.get(questionId)!
    if (!Number.isFinite(value) || value < 0 || value > max) throw new HttpError(400, `Marks must be between 0 and ${max}.`)
    const feedback = String(update.feedback ?? '').slice(0, 2000)
    if (existing) { existing.marks = value; existing.feedback = feedback }
    else attempt.codingMarks.push({ question: questionId, marks: value, feedback })
  }
  await gradeAttempt(attempt, room.codingMarks ?? 10)
  await attempt.save()
  return NextResponse.json(await detail(room, attempt))
})

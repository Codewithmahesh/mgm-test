import { NextResponse } from 'next/server'
import { handler, requireStudent } from '@/lib/auth'
import { codingAnswer, resultsVisible, submitIfExpired } from '@/lib/exams'
import { ExamRoom, Question } from '@/lib/models'
import { findOwnAttempt } from '@/lib/student-exam'

type Context = { params: Promise<{ id: string }> }

/**
 * GET /api/student/attempts/:id/result — score and per-question review, once the room's
 * result setting allows it (after submitting, after the exam ends, or never).
 */
export const GET = handler(async (_request: Request, context: Context) => {
  const student = await requireStudent()
  const attempt = await submitIfExpired(await findOwnAttempt(student, (await context.params).id))
  const room = await ExamRoom.findById(attempt.room).select('title code status showResults codingMarks').lean()
  const visible = room ? resultsVisible(room, attempt) : false

  const base = {
    id: String(attempt._id),
    room: { title: room?.title ?? 'Deleted exam', code: room?.code ?? '', status: room?.status ?? 'closed', showResults: room?.showResults ?? 'after_end' },
    status: attempt.status,
    autoSubmitted: attempt.autoSubmitted ?? false,
    autoSubmitReason: attempt.autoSubmitReason ?? '',
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt ?? null,
    totalQuestions: attempt.questions.length,
    visible,
  }
  if (!visible) return NextResponse.json(base)

  const questions = await Question.find({ _id: { $in: attempt.questions } }).select('type text options correctIndex explanation title points').lean()
  const byId = new Map(questions.map(q => [String(q._id), q]))
  const marks = new Map(attempt.codingMarks.map(m => [String(m.question), m]))
  return NextResponse.json({
    ...base,
    score: attempt.score,
    maxScore: attempt.maxScore,
    mcqScore: attempt.mcqScore ?? attempt.score,
    codingScore: attempt.codingScore ?? 0,
    correctCount: attempt.correctCount,
    wrongCount: attempt.wrongCount ?? 0,
    codingPending: attempt.codingPending ?? 0,
    items: attempt.questions.map((id, index) => {
      const q = byId.get(String(id))
      const answer = attempt.answers[index]
      if (!q) return { number: index + 1, type: 'removed' }
      if (q.type === 'coding') {
        const mark = marks.get(String(id))
        return { number: index + 1, type: 'coding', title: q.title, points: q.points ?? room?.codingMarks ?? 10, answer: codingAnswer(answer), marks: mark?.marks ?? null, feedback: mark?.feedback ?? '' }
      }
      return { number: index + 1, type: q.type, text: q.text, options: q.options, correctIndex: q.correctIndex, selected: typeof answer === 'number' ? answer : null, explanation: q.explanation ?? '' }
    }),
  })
})

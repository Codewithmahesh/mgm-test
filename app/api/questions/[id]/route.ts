import { NextResponse } from 'next/server'
import { HttpError, handler, readJson, requireTeacher } from '@/lib/auth'
import { gradeAttempt, refreshPool } from '@/lib/exams'
import { Attempt, ExamRoom, Question, isObjectId } from '@/lib/models'
import { normalizeQuestion, serializeQuestion } from '@/lib/questions'

type Context = { params: Promise<{ id: string }> }

async function findOwned(context: Context) {
  const teacher = await requireTeacher()
  const { id } = await context.params
  if (!isObjectId(id)) throw new HttpError(404, 'Question not found.')
  const question = await Question.findOne({ _id: id, teacher: teacher._id })
  if (!question) throw new HttpError(404, 'Question not found.')
  return { teacher, question }
}

/** PATCH /api/questions/:id — edit a question or move it to another room (room: null to unassign). */
export const PATCH = handler(async (request: Request, context: Context) => {
  const { teacher, question } = await findOwned(context)
  const body = await readJson(request)
  const previousRoom = question.room ? String(question.room) : null
  const before = JSON.stringify([question.type, question.options, question.correctIndex])

  if (['text', 'options', 'answer', 'correctIndex', 'type', 'bloom', 'set', 'topic', 'explanation'].some(key => key in body)) {
    const result = normalizeQuestion({ ...serializeQuestion(question.toObject()), ...body })
    if (typeof result === 'string') throw new HttpError(400, `This question ${result}.`)
    question.set(result)
  }
  if ('room' in body) {
    const room = body.room
    if (room !== null && (!isObjectId(room) || !(await ExamRoom.exists({ _id: room, teacher: teacher._id })))) throw new HttpError(404, 'Exam room not found.')
    question.set('room', room)
  }
  await question.save()

  if (JSON.stringify([question.type, question.options, question.correctIndex]) !== before) {
    const affected = await Attempt.find({ questions: question._id, status: 'submitted' })
    const rooms = new Map((await ExamRoom.find({ _id: { $in: affected.map(a => a.room) } }).select('codingMarks').lean()).map(r => [String(r._id), r.codingMarks]))
    for (const attempt of affected) { await gradeAttempt(attempt, rooms.get(String(attempt.room)) ?? 10); await attempt.save() }
  }

  const nextRoom = question.room ? String(question.room) : null
  if (previousRoom !== nextRoom) await Promise.all([previousRoom && refreshPool(previousRoom), nextRoom && refreshPool(nextRoom)])
  return NextResponse.json({ question: serializeQuestion(question.toObject()) })
})

export const DELETE = handler(async (_request: Request, context: Context) => {
  const { question } = await findOwned(context)
  await question.deleteOne()
  if (question.room) await refreshPool(question.room)
  return NextResponse.json({ ok: true })
})

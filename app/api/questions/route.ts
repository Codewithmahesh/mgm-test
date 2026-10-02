import { NextResponse } from 'next/server'
import { HttpError, handler, readJson, requireTeacher } from '@/lib/auth'
import { refreshPool } from '@/lib/exams'
import { ExamRoom, Question, isObjectId } from '@/lib/models'
import { notifyQuestionsAdded } from '@/lib/schedule'
import { normalizeQuestion, serializeQuestion } from '@/lib/questions'

const MAX_PER_REQUEST = 1200

/** GET /api/questions?room=<id|unassigned>&type=&q=&page= — the teacher's question bank. */
export const GET = handler(async (request: Request) => {
  const teacher = await requireTeacher()
  const url = new URL(request.url)
  const room = url.searchParams.get('room')
  const type = url.searchParams.get('type')
  const search = url.searchParams.get('q')?.trim()
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 50))

  const filter: Record<string, unknown> = { teacher: teacher._id }
  if (room === 'unassigned') filter.room = null
  else if (room && isObjectId(room)) filter.room = room
  if (type && ['mcq', 'tf', 'coding'].includes(type)) filter.type = type
  if (search) filter.text = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }

  const [total, questions] = await Promise.all([
    Question.countDocuments(filter),
    Question.find(filter).sort(url.searchParams.get('order') === 'paper' ? { type: 1, createdAt: 1, _id: 1 } : { createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ])
  return NextResponse.json({ total, page, limit, questions: questions.map(serializeQuestion) })
})

/** POST /api/questions { questions: [...], room?, source? } — saves questions to the bank (and optionally a room). */
export const POST = handler(async (request: Request) => {
  const teacher = await requireTeacher()
  const body = await readJson<{ questions?: unknown[]; room?: string | null; source?: string }>(request)
  const items = Array.isArray(body.questions) ? body.questions : []
  if (!items.length) throw new HttpError(400, 'No questions to save.')
  if (items.length > MAX_PER_REQUEST) throw new HttpError(400, `Save at most ${MAX_PER_REQUEST} questions at a time.`)

  let roomId: string | null = null
  if (body.room) {
    if (!isObjectId(body.room) || !(await ExamRoom.exists({ _id: body.room, teacher: teacher._id }))) throw new HttpError(404, 'Exam room not found.')
    roomId = body.room
  }
  const source = ['csv', 'ai', 'manual'].includes(String(body.source)) ? String(body.source) : 'manual'

  const errors: string[] = []
  const docs = items.flatMap((item, index) => {
    const result = normalizeQuestion((item ?? {}) as Record<string, unknown>)
    if (typeof result === 'string') { errors.push(`Question ${index + 1}: ${result}`); return [] }
    return [{ ...result, teacher: teacher._id, room: roomId, source }]
  })
  if (!docs.length) throw new HttpError(400, errors[0] ?? 'None of the questions were valid.')

  const saved = await Question.insertMany(docs)
  if (roomId) await refreshPool(roomId)
  const coding = docs.filter(q => q.type === 'coding').length
  const tf = docs.filter(q => q.type === 'tf').length
  await notifyQuestionsAdded(teacher, roomId ? await ExamRoom.findById(roomId).select('-pool').lean() : null, { mcq: docs.length - coding - tf, tf, coding, source })
  return NextResponse.json({ saved: saved.length, errors, questions: saved.map(q => serializeQuestion(q.toObject())) }, { status: 201 })
})

/**
 * DELETE /api/questions { ids?: string[], room?: string | 'unassigned' } — deletes several questions at
 * once: the given ids, or every question in one exam room's group. Papers already dealt to students keep
 * their copy of the paper (attempts store question ids; removed questions show as "removed").
 */
export const DELETE = handler(async (request: Request) => {
  const teacher = await requireTeacher()
  const body = await readJson<{ ids?: unknown[]; room?: unknown }>(request)
  const filter: Record<string, unknown> = { teacher: teacher._id }
  if (Array.isArray(body.ids)) {
    const ids = body.ids.filter(isObjectId)
    if (!ids.length) throw new HttpError(400, 'Choose at least one question.')
    filter._id = { $in: ids }
  } else if (body.room === 'unassigned') filter.room = null
  else if (isObjectId(body.room)) filter.room = body.room
  else throw new HttpError(400, 'Say which questions to delete.')

  const rooms = (await Question.distinct('room', filter)).filter(Boolean).map(String)
  const result = await Question.deleteMany(filter)
  await Promise.all(rooms.map(room => refreshPool(room)))
  return NextResponse.json({ deleted: result.deletedCount })
})

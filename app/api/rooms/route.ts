import { NextResponse } from 'next/server'
import { HttpError, handler, readJson, requireTeacher } from '@/lib/auth'
import { refreshPool, uniqueRoomCode } from '@/lib/exams'
import { ExamRoom, Question, isObjectId } from '@/lib/models'
import { copyOf, normalizeQuestion } from '@/lib/questions'
import { assertPaperSettings, roomSettings, withRoomStats } from '@/lib/rooms'
import { maybeRunScheduleTick, notifyScheduled } from '@/lib/schedule'

export const GET = handler(async () => {
  const teacher = await requireTeacher()
  // Backstop for hosts without a scheduler, so rooms due to auto-open show up as open.
  await maybeRunScheduleTick()
  const rooms = await ExamRoom.find({ teacher: teacher._id }).select('-pool').sort({ createdAt: -1 }).lean()
  return NextResponse.json({ rooms: await withRoomStats(rooms) })
})

/**
 * POST /api/rooms — creates a room (as a draft unless status is given).
 * Optional: questions: [...new questions], questionIds: [...bank questions to copy in], source.
 */
export const POST = handler(async (request: Request) => {
  const teacher = await requireTeacher()
  const body = await readJson(request)
  const settings = roomSettings(body)
  if ((settings.startsAt as Date).getTime() < Date.now() - 60_000) throw new HttpError(400, 'The start time is in the past. Choose a time from now on.')
  assertPaperSettings(settings as Parameters<typeof assertPaperSettings>[0])

  const newQuestions = Array.isArray(body.questions) ? body.questions : []
  const bankIds = (Array.isArray(body.questionIds) ? body.questionIds : []).filter(isObjectId)
  const source = ['csv', 'ai', 'manual'].includes(String(body.source)) ? String(body.source) : 'manual'

  const errors: string[] = []
  const fresh = newQuestions.flatMap((item, index) => {
    const result = normalizeQuestion((item ?? {}) as Record<string, unknown>)
    if (typeof result === 'string') { errors.push(`Question ${index + 1}: ${result}`); return [] }
    return [{ ...result, source }]
  })
  const copied = bankIds.length ? (await Question.find({ _id: { $in: bankIds }, teacher: teacher._id }).lean()).map(q => copyOf(q as unknown as Record<string, unknown>)) : []

  const room = await ExamRoom.create({ ...settings, teacher: teacher._id, code: await uniqueRoomCode() })
  const all = [...fresh, ...copied]
  if (all.length) {
    await Question.insertMany(all.map(q => ({ ...q, teacher: teacher._id, room: room._id })))
    await refreshPool(room._id)
  }
  if (room.startsAt) await notifyScheduled(room.toObject(), teacher, false)

  const [serialized] = await withRoomStats([room.toObject()])
  return NextResponse.json({ room: serialized, errors }, { status: 201 })
})


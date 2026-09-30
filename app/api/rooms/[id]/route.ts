import { emailRoomResults } from '@/lib/result-email'
import { NextResponse } from 'next/server'
import { HttpError, handler, readJson, requireTeacher } from '@/lib/auth'
import { refreshPool, submitAttempt } from '@/lib/exams'
import { Attempt, JoinRequest, Question, isObjectId } from '@/lib/models'
import { copyOf, serializeQuestion } from '@/lib/questions'
import { assertPaperSettings, findTeacherRoom, openProblem, roomSettings, withRoomStats } from '@/lib/rooms'
import { notifyExamEnded, notifyRoomDeleted, notifyScheduled } from '@/lib/schedule'

type Context = { params: Promise<{ id: string }> }

/** GET /api/rooms/:id — room details plus its question pool. */
export const GET = handler(async (_request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const room = await findTeacherRoom(teacher._id, (await context.params).id)
  const [[serialized], questions] = await Promise.all([
    withRoomStats([room.toObject()]),
    Question.find({ room: room._id }).sort({ type: 1, createdAt: 1, _id: 1 }).lean(),
  ])
  return NextResponse.json({ room: serialized, questions: questions.map(serializeQuestion) })
})

/**
 * PATCH /api/rooms/:id — update settings or status. Opening checks the room has enough questions.
 * Ending a room submits every unfinished attempt. { extendMinutes } adds time to everyone still writing.
 */
export const PATCH = handler(async (request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const room = await findTeacherRoom(teacher._id, (await context.params).id)
  const body = await readJson(request)
  const settings = roomSettings(body, true)
  assertPaperSettings({ ...room.toObject(), ...settings } as Parameters<typeof assertPaperSettings>[0])

  if ((settings.status ?? room.status) === 'open') {
    const problem = await openProblem({ ...room.toObject(), ...settings } as Parameters<typeof openProblem>[0])
    if (problem) throw new HttpError(400, problem)
  }
  const ending = settings.status === 'closed' && room.status !== 'closed'
  if (settings.status === 'closed') room.endedAt = new Date()
  if (settings.status === 'open') room.endedAt = undefined
  const before = room.startsAt?.getTime() ?? null
  const startChanged = 'startsAt' in settings && ((settings.startsAt as Date | null)?.getTime() ?? null) !== before
  if (startChanged && (settings.startsAt as Date).getTime() < Date.now() - 60_000) throw new HttpError(400, 'The start time is in the past. Choose a time from now on.')
  // A new time (or turning auto-open on or off) starts the reminder and auto-open bookkeeping afresh.
  if (startChanged || ('autoOpen' in settings && settings.autoOpen !== room.autoOpen)) { room.reminderSentAt = null; room.autoOpenFailedAt = null }
  room.set(settings)
  await room.save()
  if (startChanged && room.startsAt && room.status === 'draft') await notifyScheduled(room.toObject(), teacher, before !== null)

  if (settings.status === 'closed') {
    const open = await Attempt.find({ room: room._id, status: 'in_progress' })
    for (const attempt of open) await submitAttempt(attempt, { auto: true, reason: 'room_closed' })
    if (ending) {
      const [stats] = await withRoomStats([room.toObject()])
      await notifyExamEnded(room, teacher, stats, open.length)
    }
    // Results that only show once the exam ends go out to every student now.
    emailRoomResults(room._id)
  }
  const extend = Number(body.extendMinutes)
  if (Number.isFinite(extend) && extend > 0 && room.status === 'closed') throw new HttpError(409, 'This exam has ended, so time can no longer be extended.')
  if (Number.isFinite(extend) && extend > 0 && extend <= 180) {
    await Attempt.updateMany({ room: room._id, status: 'in_progress' }, [{ $set: { endsAt: { $add: ['$endsAt', extend * 60_000] } } }], { updatePipeline: true })
  }

  const [serialized] = await withRoomStats([room.toObject()])
  return NextResponse.json({ room: serialized })
})

/** POST /api/rooms/:id { questionIds } — copies bank questions into this room's pool. */
export const POST = handler(async (request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const room = await findTeacherRoom(teacher._id, (await context.params).id)
  const body = await readJson(request)
  const ids = (Array.isArray(body.questionIds) ? body.questionIds : []).filter(isObjectId)
  if (!ids.length) throw new HttpError(400, 'Choose at least one question.')
  const source = await Question.find({ _id: { $in: ids }, teacher: teacher._id }).lean()
  await Question.insertMany(source.map(q => ({ ...copyOf(q as unknown as Record<string, unknown>), teacher: teacher._id, room: room._id })))
  await refreshPool(room._id)
  return NextResponse.json({ added: source.length }, { status: 201 })
})

/** DELETE /api/rooms/:id — removes the room and its results. Its questions stay in the bank, unassigned. */
export const DELETE = handler(async (_request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const room = await findTeacherRoom(teacher._id, (await context.params).id)
  const [questions, attempts] = await Promise.all([Question.updateMany({ room: room._id }, { $set: { room: null } }), Attempt.deleteMany({ room: room._id }), JoinRequest.deleteMany({ room: room._id })])
  await room.deleteOne()
  await notifyRoomDeleted(room, teacher, { attempts: attempts.deletedCount, questions: questions.modifiedCount })
  return NextResponse.json({ ok: true })
})

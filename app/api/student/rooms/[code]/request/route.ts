import { NextResponse } from 'next/server'
import { HttpError, handler, rateLimit, requireStudent } from '@/lib/auth'
import { Attempt, JoinRequest } from '@/lib/models'
import { findRoomByCode, requestToJoin, requiresApproval, startBlocker } from '@/lib/student-exam'

type Context = { params: Promise<{ code: string }> }

/** POST /api/student/rooms/:code/request — asks the faculty to admit this student to the waiting room. */
export const POST = handler(async (_request: Request, context: Context) => {
  const student = await requireStudent()
  await rateLimit(`join-request:student:${student._id}`, 30, 10 * 60)
  const room = await findRoomByCode((await context.params).code)
  if (!requiresApproval(room)) throw new HttpError(400, 'This exam does not need approval. You can start it directly.')
  if (await Attempt.exists({ room: room._id, studentEmail: student.officialEmail })) throw new HttpError(409, 'You have already started this exam.')
  const blocker = startBlocker(room, student)
  if (blocker) throw new HttpError(403, blocker)

  const request = await requestToJoin(room, student)
  return NextResponse.json({ request: request ? { status: request.status, requestedAt: request.requestedAt } : null }, { status: 201 })
})

/** DELETE /api/student/rooms/:code/request — withdraws a pending request. */
export const DELETE = handler(async (_request: Request, context: Context) => {
  const student = await requireStudent()
  const room = await findRoomByCode((await context.params).code)
  await JoinRequest.deleteOne({ room: room._id, studentEmail: student.officialEmail, status: 'pending' })
  return NextResponse.json({ ok: true })
})

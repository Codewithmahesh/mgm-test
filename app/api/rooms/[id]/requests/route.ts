import { NextResponse } from 'next/server'
import { HttpError, handler, readJson, requireTeacher } from '@/lib/auth'
import { Attempt, JoinRequest, isObjectId } from '@/lib/models'
import { findTeacherRoom } from '@/lib/rooms'

type Context = { params: Promise<{ id: string }> }

/**
 * GET /api/rooms/:id/requests — the waiting room: students asking to join, plus those admitted
 * who haven't started yet. Polled every few seconds by the faculty's room page.
 */
export const GET = handler(async (_request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const room = await findTeacherRoom(teacher._id, (await context.params).id)
  const [requests, started] = await Promise.all([
    JoinRequest.find({ room: room._id }).sort({ requestedAt: 1 }).lean(),
    Attempt.distinct('studentEmail', { room: room._id }),
  ])
  const startedSet = new Set(started)
  const rows = requests.map(r => ({
    id: String(r._id),
    studentName: r.studentName || r.studentEmail,
    studentEmail: r.studentEmail,
    rollNumber: r.rollNumber ?? '',
    className: r.className ?? '',
    status: r.status,
    started: startedSet.has(r.studentEmail),
    requestedAt: r.requestedAt,
    decidedAt: r.decidedAt ?? null,
  }))
  return NextResponse.json({
    requireApproval: room.requireApproval ?? true,
    pending: rows.filter(r => r.status === 'pending'),
    admittedWaiting: rows.filter(r => r.status === 'admitted' && !r.started),
    rejected: rows.filter(r => r.status === 'rejected'),
    counts: { pending: rows.filter(r => r.status === 'pending').length, admitted: rows.filter(r => r.status === 'admitted').length },
  })
})

/**
 * PATCH /api/rooms/:id/requests { action: 'admit' | 'reject', ids?: string[], all?: boolean }
 * Admits or declines the chosen pending requests, or every pending request with all: true.
 */
export const PATCH = handler(async (request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const room = await findTeacherRoom(teacher._id, (await context.params).id)
  const body = await readJson(request)
  const action = body.action === 'reject' ? 'rejected' : body.action === 'admit' ? 'admitted' : null
  if (!action) throw new HttpError(400, 'Choose admit or reject.')

  const filter: Record<string, unknown> = { room: room._id }
  if (body.all === true) filter.status = 'pending'
  else {
    const ids = (Array.isArray(body.ids) ? body.ids : []).filter(isObjectId)
    if (!ids.length) throw new HttpError(400, 'Choose at least one student.')
    filter._id = { $in: ids }
    // Admitting can also undo a decline; declining only applies to students still waiting.
    filter.status = action === 'admitted' ? { $in: ['pending', 'rejected'] } : 'pending'
  }
  const result = await JoinRequest.updateMany(filter, { $set: { status: action, decidedAt: new Date() } })
  return NextResponse.json({ updated: result.modifiedCount })
})

import { NextResponse } from 'next/server'
import { clientIp, handler, rateLimit, requireStudent } from '@/lib/auth'
import { findRoomByCode, lobbyView } from '@/lib/student-exam'

type Context = { params: Promise<{ code: string }> }

/** GET /api/student/rooms/:code — exam details and instructions shown before starting. */
export const GET = handler(async (request: Request, context: Context) => {
  const student = await requireStudent()
  await rateLimit(`lobby:student:${student._id}`, 120, 10 * 60)
  await rateLimit(`lobby:ip:${clientIp(request)}`, 5000, 10 * 60)
  const room = await findRoomByCode((await context.params).code)
  return NextResponse.json(await lobbyView(room, student))
})

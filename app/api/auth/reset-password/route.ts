import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { HttpError, handler, readJson, setTeacherSession } from '@/lib/auth'
import { connectDb } from '@/lib/db'
import { PasswordReset, Teacher } from '@/lib/models'
import { verifyToken, type OtpTicket } from '@/lib/session'

/** POST /api/auth/reset-password { ticket, password } — sets a new faculty password after OTP verification and signs in. */
export const POST = handler(async (request: Request) => {
  const body = await readJson(request)
  const password = String(body.password ?? '')
  const ticket = await verifyToken<OtpTicket>(String(body.ticket ?? ''), 'otp-ticket')
  if (!ticket || ticket.account !== 'teacher' || ticket.purpose !== 'reset') throw new HttpError(400, 'Your verification expired. Please request a new code.')
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.')

  await connectDb()
  const teacher = await Teacher.findByIdAndUpdate(ticket.sub, { passwordHash: await bcrypt.hash(password, 12) }, { returnDocument: 'after' })
  if (!teacher) throw new HttpError(400, 'This account no longer exists.')
  // Clear any reset link issued by the old link-based flow.
  await PasswordReset.deleteMany({ role: 'teacher', account: teacher._id })

  await setTeacherSession(teacher)
  return NextResponse.json({ ok: true })
})

import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { HttpError, handler, readJson, setStudentSession } from '@/lib/auth'
import { connectDb } from '@/lib/db'
import { Student } from '@/lib/models'
import { verifyToken, type OtpTicket } from '@/lib/session'

/** POST /api/student/auth/password { ticket, password } — sets the password after OTP verification and signs the student in. */
export const POST = handler(async (request: Request) => {
  const body = await readJson(request)
  const password = String(body.password ?? '')
  const ticket = await verifyToken<OtpTicket>(String(body.ticket ?? ''), 'otp-ticket')
  if (!ticket || ticket.account !== 'student') throw new HttpError(400, 'Your verification expired. Please request a new code.')
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.')

  await connectDb()
  const student = await Student.findById(ticket.sub)
  if (!student) throw new HttpError(400, 'This account no longer exists.')
  student.passwordHash = await bcrypt.hash(password, 12)
  student.activatedAt ??= new Date()
  await student.save()

  const session = await setStudentSession(String(student._id))
  return NextResponse.json({ ...session, profileComplete: Boolean(student.profileCompletedAt) })
})

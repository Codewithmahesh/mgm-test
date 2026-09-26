import { NextResponse } from 'next/server'
import { HttpError, clientIp, handler, rateLimit, readJson } from '@/lib/auth'
import { connectDb } from '@/lib/db'
import { Student } from '@/lib/models'
import { sendOtp } from '@/lib/otp'

/** POST /api/student/auth/otp { email, purpose: 'activate' | 'reset' } — emails a 6-digit code to a listed student. */
export const POST = handler(async (request: Request) => {
  const body = await readJson(request)
  const email = String(body.email ?? '').trim().toLowerCase()
  const purpose = body.purpose === 'reset' ? 'reset' : 'activate'
  if (!email) throw new HttpError(400, 'Enter your college email.')

  await rateLimit(`otp:ip:${clientIp(request)}`, 500, 60 * 60)
  await rateLimit(`otp:email:${email}`, 5, 60 * 60)
  await connectDb()

  const student = await Student.findOne({ officialEmail: email }).select('officialEmail name activatedAt').lean()
  if (!student) throw new HttpError(404, "This email isn't on the student list. Ask your faculty to add you.")
  if (purpose === 'activate' && student.activatedAt) throw new HttpError(409, 'This account is already active. Sign in with your password, or use "Forgot password".')
  if (purpose === 'reset' && !student.activatedAt) throw new HttpError(409, "This account hasn't been activated yet. Use \"Activate account\" first.")

  await sendOtp('student', { _id: student._id, email: student.officialEmail!, name: student.name }, purpose)
  return NextResponse.json({ message: `We sent a 6-digit code to ${email}.` })
})

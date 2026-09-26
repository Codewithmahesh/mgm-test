import { NextResponse } from 'next/server'
import { HttpError, clientIp, handler, rateLimit, readJson } from '@/lib/auth'
import { connectDb } from '@/lib/db'
import { Student } from '@/lib/models'
import { signToken } from '@/lib/session'
import { verifyOtp } from '@/lib/otp'

/** POST /api/student/auth/verify { email, otp, purpose } — checks the code and returns a 15-minute ticket for setting a password. */
export const POST = handler(async (request: Request) => {
  const body = await readJson(request)
  const email = String(body.email ?? '').trim().toLowerCase()
  const otp = String(body.otp ?? '').replace(/\D/g, '')
  const purpose = body.purpose === 'reset' ? 'reset' : 'activate'
  if (otp.length !== 6) throw new HttpError(400, 'Enter the 6-digit code from your email.')

  await rateLimit(`otp-verify:ip:${clientIp(request)}`, 1000, 15 * 60)
  await rateLimit(`otp-verify:email:${email}`, 15, 15 * 60)
  await connectDb()
  const student = await Student.findOne({ officialEmail: email }).select('_id').lean()
  if (!student) throw new HttpError(400, 'This code has expired. Request a new one.')

  await verifyOtp('student', student._id, otp, purpose)
  const ticket = await signToken({ sub: String(student._id), role: 'otp-ticket', purpose, account: 'student' }, 15 * 60)
  return NextResponse.json({ ticket })
})

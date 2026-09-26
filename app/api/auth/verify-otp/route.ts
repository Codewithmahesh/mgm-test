import { NextResponse } from 'next/server'
import { HttpError, clientIp, handler, rateLimit, readJson } from '@/lib/auth'
import { connectDb } from '@/lib/db'
import { Teacher } from '@/lib/models'
import { verifyOtp } from '@/lib/otp'
import { signToken } from '@/lib/session'

/** POST /api/auth/verify-otp { email, otp } — checks a faculty reset code and returns a 15-minute ticket for setting a new password. */
export const POST = handler(async (request: Request) => {
  const body = await readJson(request)
  const email = String(body.email ?? '').trim().toLowerCase()
  const otp = String(body.otp ?? '').replace(/\D/g, '')
  if (otp.length !== 6) throw new HttpError(400, 'Enter the 6-digit code from your email.')

  await rateLimit(`otp-verify:ip:${clientIp(request)}`, 600, 15 * 60)
  await rateLimit(`otp-verify:email:${email}`, 15, 15 * 60)
  await connectDb()
  const teacher = await Teacher.findOne({ email }).select('_id').lean()
  if (!teacher) throw new HttpError(400, 'This code has expired. Request a new one.')

  await verifyOtp('teacher', teacher._id, otp, 'reset')
  const ticket = await signToken({ sub: String(teacher._id), role: 'otp-ticket', purpose: 'reset', account: 'teacher' }, 15 * 60)
  return NextResponse.json({ ticket })
})

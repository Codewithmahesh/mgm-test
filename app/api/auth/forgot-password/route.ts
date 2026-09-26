import { NextResponse } from 'next/server'
import { HttpError, clientIp, handler, rateLimit, readJson } from '@/lib/auth'
import { connectDb } from '@/lib/db'
import { Teacher } from '@/lib/models'
import { sendOtp } from '@/lib/otp'

/** POST /api/auth/forgot-password { email } — emails a 6-digit reset code to a faculty account. */
export const POST = handler(async (request: Request) => {
  const body = await readJson(request)
  const email = String(body.email ?? '').trim().toLowerCase()
  if (!email) throw new HttpError(400, 'Enter your email address.')

  await rateLimit(`reset:ip:${clientIp(request)}`, 60, 60 * 60)
  await rateLimit(`reset:email:${email}`, 5, 60 * 60)
  await connectDb()

  const teacher = await Teacher.findOne({ email }).select('email name').lean()
  // Same response whether or not the account exists, so emails can't be enumerated.
  if (teacher) await sendOtp('teacher', { _id: teacher._id, email: teacher.email, name: teacher.name }, 'reset')
  return NextResponse.json({ message: `If a faculty account exists for ${email}, we sent it a 6-digit code.` })
})

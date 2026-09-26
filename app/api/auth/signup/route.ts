import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { HttpError, clientIp, handler, rateLimit, readJson, setTeacherSession } from '@/lib/auth'
import { connectDb } from '@/lib/db'
import { Teacher } from '@/lib/models'

export const POST = handler(async (request: Request) => {
  const body = await readJson(request)
  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  const department = String(body.department ?? '').trim().slice(0, 80)

  if (name.length < 2) throw new HttpError(400, 'Enter your full name.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.')
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.')
  const requiredCode = process.env.FACULTY_SIGNUP_CODE?.trim()
  if (requiredCode && String(body.signupCode ?? '').trim() !== requiredCode) throw new HttpError(403, 'The faculty sign-up code is incorrect. Ask your administrator for it.')

  await rateLimit(`signup:ip:${clientIp(request)}`, 30, 60 * 60)
  await connectDb()
  if (await Teacher.exists({ email })) throw new HttpError(409, 'An account with this email already exists. Try signing in.')

  const teacher = await Teacher.create({ name: name.slice(0, 80), email, department, passwordHash: await bcrypt.hash(password, 12) })
  await setTeacherSession(teacher)
  return NextResponse.json({ teacher: { id: String(teacher._id), name: teacher.name, email: teacher.email } }, { status: 201 })
})

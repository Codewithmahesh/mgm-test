import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { HttpError, clientIp, handler, rateLimit, readJson, setTeacherSession } from '@/lib/auth'
import { connectDb } from '@/lib/db'
import { Teacher } from '@/lib/models'

export const POST = handler(async (request: Request) => {
  const body = await readJson(request)
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  if (!email || !password) throw new HttpError(400, 'Enter your email and password.')

  await rateLimit(`login:ip:${clientIp(request)}`, 200, 15 * 60)
  await rateLimit(`login:email:${email}`, 8, 15 * 60)
  await connectDb()

  const teacher = await Teacher.findOne({ email })
  if (!teacher || !(await bcrypt.compare(password, teacher.passwordHash))) throw new HttpError(401, 'Incorrect email or password.')

  const session = await setTeacherSession(teacher)
  return NextResponse.json({ ...session, teacher: { id: String(teacher._id), name: teacher.name, email: teacher.email } })
})

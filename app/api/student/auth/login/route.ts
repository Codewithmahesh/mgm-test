import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { HttpError, clientIp, handler, rateLimit, readJson, setStudentSession } from '@/lib/auth'
import { connectDb } from '@/lib/db'
import { Student } from '@/lib/models'

export const POST = handler(async (request: Request) => {
  const body = await readJson(request)
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  if (!email || !password) throw new HttpError(400, 'Enter your college email and password.')

  await rateLimit(`student-login:ip:${clientIp(request)}`, 1000, 15 * 60)
  await rateLimit(`student-login:email:${email}`, 8, 15 * 60)
  await connectDb()

  const student = await Student.findOne({ officialEmail: email }).select('passwordHash activatedAt profileCompletedAt')
  if (student && !student.activatedAt) throw new HttpError(409, 'Your account is not activated yet. Use "Activate account" to set your password.')
  if (!student?.passwordHash || !(await bcrypt.compare(password, student.passwordHash))) throw new HttpError(401, 'Incorrect email or password.')

  await setStudentSession(String(student._id))
  return NextResponse.json({ profileComplete: Boolean(student.profileCompletedAt) })
})

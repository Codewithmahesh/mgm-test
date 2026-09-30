import { NextResponse } from 'next/server'
import { HttpError, handler, readJson, requireTeacher } from '@/lib/auth'
import { Teacher } from '@/lib/models'

type TeacherDoc = { _id: unknown; name: string; email: string; department?: string | null }
const serialize = (teacher: TeacherDoc) => ({ id: String(teacher._id), name: teacher.name, email: teacher.email, department: teacher.department ?? '' })

export const GET = handler(async () => {
  const teacher = await requireTeacher()
  return NextResponse.json({ teacher: serialize(teacher) })
})

/** PATCH /api/auth/me { name?, department? } — faculty edit their own profile. The email is the sign-in and stays fixed. */
export const PATCH = handler(async (request: Request) => {
  const teacher = await requireTeacher()
  const body = await readJson(request)
  const update: { name?: string; department?: string } = {}
  if (body.name !== undefined) {
    const name = String(body.name).trim().replace(/\s+/g, ' ')
    if (name.length < 2) throw new HttpError(400, 'Enter your full name.')
    update.name = name.slice(0, 80)
  }
  if (body.department !== undefined) update.department = String(body.department).trim().slice(0, 80)
  const saved = await Teacher.findByIdAndUpdate(teacher._id, update, { returnDocument: 'after' }).select('-passwordHash').lean()
  if (!saved) throw new HttpError(401, 'Your account no longer exists. Please sign in again.')
  return NextResponse.json({ teacher: serialize(saved) })
})

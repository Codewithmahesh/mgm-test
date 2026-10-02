import { NextResponse } from 'next/server'
import { confirmDeletion, deleteTeacherAccount } from '@/lib/account-deletion'
import { HttpError, clearCookie, handler, rateLimit, readJson, requireTeacher } from '@/lib/auth'
import { Teacher } from '@/lib/models'
import { TEACHER_COOKIE } from '@/lib/session'

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

/**
 * DELETE /api/auth/me { password, confirm: "DELETE" } — deletes the faculty account for good, with its exam
 * rooms (and the attempts in them), question bank, AI generations and practicals. See lib/account-deletion.ts.
 */
export const DELETE = handler(async (request: Request) => {
  const teacher = await requireTeacher()
  await rateLimit(`delete-account:teacher:${teacher._id}`, 5, 15 * 60)
  const { passwordHash } = (await Teacher.findById(teacher._id).select('passwordHash').lean()) ?? {}
  await confirmDeletion(passwordHash, await readJson(request))
  await deleteTeacherAccount(teacher._id)
  await clearCookie(TEACHER_COOKIE)
  return NextResponse.json({ ok: true })
})

import { NextResponse } from 'next/server'
import { confirmDeletion, deleteStudentAccount } from '@/lib/account-deletion'
import { HttpError, clearCookie, handler, rateLimit, readJson, requireStudent } from '@/lib/auth'
import { BRANCHES, Classroom, Student, YEARS, isObjectId } from '@/lib/models'
import { STUDENT_COOKIE } from '@/lib/session'
import { classroomFor, serializeStudent } from '@/lib/students'

export const GET = handler(async () => {
  const student = await requireStudent({ requireProfile: false })
  return NextResponse.json({ student: serializeStudent(student.toObject()) })
})

/** PATCH /api/student/me { name, classroomId, year, branch, division, rollNumber, prn } — completes or updates the profile. */
export const PATCH = handler(async (request: Request) => {
  const student = await requireStudent({ requireProfile: false })
  const body = await readJson(request)
  const name = String(body.name ?? '').trim().replace(/\s+/g, ' ')
  const rollNumber = String(body.rollNumber ?? '').trim()
  const prn = String(body.prn ?? '').trim()
  const classroomId = String(body.classroomId ?? '').trim()

  if (name.length < 2) throw new HttpError(400, 'Enter your full name.')
  if (!rollNumber || rollNumber.length > 20) throw new HttpError(400, 'Enter your roll number.')
  if (prn.length > 30) throw new HttpError(400, 'PRN is too long.')

  let classroom = null
  if (classroomId && isObjectId(classroomId)) {
    classroom = await Classroom.findById(classroomId)
  }

  if (!classroom) {
    const rawYear = String(body.year ?? '').trim()
    const year = (YEARS as readonly string[]).find(y => y.toLowerCase() === rawYear.toLowerCase()) || (rawYear === 'LY' ? 'B.Tech' : rawYear)
    const branch = String(body.branch ?? '').toUpperCase()
    const division = String(body.division ?? '').toUpperCase().trim()

    if (!(YEARS as readonly string[]).includes(year)) throw new HttpError(400, 'Please select your class.')
    if (!(branch in BRANCHES)) throw new HttpError(400, 'Choose your branch.')
    if (!/^[A-Z]{1,2}$/.test(division)) throw new HttpError(400, 'Enter your division, e.g. A.')

    classroom = await classroomFor(year, branch, division)
  }

  student.set({ name: name.slice(0, 100), rollNumber, prn: prn || undefined, classroom: classroom?._id })
  student.profileCompletedAt ??= new Date()
  try {
    await student.save()
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new HttpError(409, 'That PRN is already registered to another student.')
    throw error
  }
  await student.populate('classroom')
  return NextResponse.json({ student: serializeStudent(student.toObject()) })
})

/**
 * DELETE /api/student/me { password, confirm: "DELETE" } — deletes the student account for good, with its exam
 * attempts, join requests and practical work. See lib/account-deletion.ts.
 */
export const DELETE = handler(async (request: Request) => {
  const student = await requireStudent({ requireProfile: false })
  await rateLimit(`delete-account:student:${student._id}`, 5, 15 * 60)
  const { passwordHash } = (await Student.findById(student._id).select('passwordHash').lean()) ?? {}
  await confirmDeletion(passwordHash, await readJson(request))
  await deleteStudentAccount(student._id)
  await clearCookie(STUDENT_COOKIE)
  return NextResponse.json({ ok: true })
})

import { NextResponse } from 'next/server'
import { HttpError, handler, readJson, requireStudent } from '@/lib/auth'
import { BRANCHES, YEARS } from '@/lib/models'
import { classroomFor, serializeStudent } from '@/lib/students'

export const GET = handler(async () => {
  const student = await requireStudent({ requireProfile: false })
  return NextResponse.json({ student: serializeStudent(student.toObject()) })
})

/** PATCH /api/student/me { name, year, branch, division, rollNumber, prn } — completes or updates the profile. */
export const PATCH = handler(async (request: Request) => {
  const student = await requireStudent({ requireProfile: false })
  const body = await readJson(request)
  const name = String(body.name ?? '').trim().replace(/\s+/g, ' ')
  const rawYear = String(body.year ?? '').trim()
  const year = (YEARS as readonly string[]).find(y => y.toLowerCase() === rawYear.toLowerCase()) || rawYear
  const branch = String(body.branch ?? '').toUpperCase()
  const division = String(body.division ?? '').toUpperCase().trim()
  const rollNumber = String(body.rollNumber ?? '').trim()
  const prn = String(body.prn ?? '').trim()

  if (name.length < 2) throw new HttpError(400, 'Enter your full name.')
  if (!(YEARS as readonly string[]).includes(year)) throw new HttpError(400, 'Choose your year.')
  if (!(branch in BRANCHES)) throw new HttpError(400, 'Choose your branch.')
  if (!/^[A-Z]{1,2}$/.test(division)) throw new HttpError(400, 'Enter your division, e.g. A.')
  if (!rollNumber || rollNumber.length > 20) throw new HttpError(400, 'Enter your roll number.')
  if (prn.length > 30) throw new HttpError(400, 'PRN is too long.')

  const classroom = await classroomFor(year, branch, division)
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

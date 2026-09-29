import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { HttpError, handler } from '@/lib/auth'
import { BRANCHES, Classroom, Student, YEARS, YEAR_LABELS, classLabel } from '@/lib/models'
import { STUDENT_COOKIE, TEACHER_COOKIE, verifyToken } from '@/lib/session'

/** GET /api/classrooms — every class with its student counts (for faculty) or classroom list (for students). */
export const GET = handler(async () => {
  const cookieStore = await cookies()
  const [teacherToken, studentToken] = await Promise.all([
    verifyToken(cookieStore.get(TEACHER_COOKIE)?.value, 'teacher'),
    verifyToken(cookieStore.get(STUDENT_COOKIE)?.value, 'student'),
  ])

  if (!teacherToken && !studentToken) {
    throw new HttpError(401, 'Please sign in.')
  }

  const classrooms = await Classroom.find().sort({ class: 1, branch: 1, division: 1 }).lean()

  let byId = new Map<string, { _id: unknown; total: number; active: number }>()
  let unassigned = 0

  if (teacherToken) {
    const counts = await Student.aggregate<{ _id: unknown; total: number; active: number }>([
      { $group: { _id: '$classroom', total: { $sum: 1 }, active: { $sum: { $cond: [{ $ifNull: ['$activatedAt', false] }, 1, 0] } } } },
    ])
    byId = new Map(counts.map(c => [String(c._id), c]))
    unassigned = byId.get('null')?.total ?? 0
  }

  return NextResponse.json({
    classrooms: classrooms.map(c => ({
      id: String(c._id),
      label: classLabel(c),
      year: c.class,
      branch: c.branch,
      division: c.division,
      students: byId.get(String(c._id))?.total ?? 0,
      active: byId.get(String(c._id))?.active ?? 0,
    })),
    unassigned,
    years: YEARS.map(value => ({ value, label: YEAR_LABELS[value] })),
    branches: Object.entries(BRANCHES).map(([value, label]) => ({ value, label })),
  })
})

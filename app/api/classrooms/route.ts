import { NextResponse } from 'next/server'
import { handler, requireTeacher } from '@/lib/auth'
import { BRANCHES, Classroom, Student, YEARS, YEAR_LABELS, classLabel } from '@/lib/models'

/** GET /api/classrooms — every class with its student counts, plus the year/branch choices. */
export const GET = handler(async () => {
  await requireTeacher()
  const [classrooms, counts] = await Promise.all([
    Classroom.find().sort({ class: 1, branch: 1, division: 1 }).lean(),
    Student.aggregate<{ _id: unknown; total: number; active: number }>([
      { $group: { _id: '$classroom', total: { $sum: 1 }, active: { $sum: { $cond: [{ $ifNull: ['$activatedAt', false] }, 1, 0] } } } },
    ]),
  ])
  const byId = new Map(counts.map(c => [String(c._id), c]))
  return NextResponse.json({
    classrooms: classrooms.map(c => ({ id: String(c._id), label: classLabel(c), year: c.class, branch: c.branch, division: c.division, students: byId.get(String(c._id))?.total ?? 0, active: byId.get(String(c._id))?.active ?? 0 })),
    unassigned: byId.get('null')?.total ?? 0,
    years: YEARS.map(value => ({ value, label: YEAR_LABELS[value] })),
    branches: Object.entries(BRANCHES).map(([value, label]) => ({ value, label })),
  })
})

import { NextResponse } from 'next/server'
import { handler, readJson, requireTeacher } from '@/lib/auth'
import { PracticalSubject } from '@/lib/models'
import { subjectSettings, withSubjectStats } from '@/lib/practical-subjects'

/** GET /api/practicals — the faculty member's practical subjects with progress figures. */
export const GET = handler(async () => {
  const teacher = await requireTeacher()
  const subjects = await PracticalSubject.find({ teacher: teacher._id }).sort({ createdAt: -1 }).lean()
  return NextResponse.json({ subjects: await withSubjectStats(subjects) })
})

/** POST /api/practicals { title, code?, description?, classrooms[] } — creates a practical subject. */
export const POST = handler(async (request: Request) => {
  const teacher = await requireTeacher()
  const subject = await PracticalSubject.create({ ...(await subjectSettings(await readJson(request))), teacher: teacher._id })
  const [summary] = await withSubjectStats([subject.toObject()])
  return NextResponse.json({ subject: summary }, { status: 201 })
})

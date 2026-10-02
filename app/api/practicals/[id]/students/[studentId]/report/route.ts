import { NextResponse } from 'next/server'
import { HttpError, handler, rateLimit, requireTeacher } from '@/lib/auth'
import { Student, isObjectId } from '@/lib/models'
import { buildPracticalReport } from '@/lib/practical-report'
import { findSubjectExperiment, findTeacherSubject } from '@/lib/practicals'

export const maxDuration = 300

type Context = { params: Promise<{ id: string; studentId: string }> }

/**
 * GET /api/practicals/:id/students/:studentId/report[?experiment=id] — one student's practical report for the
 * PDF: one experiment, or every experiment (including ones not attempted yet) without `experiment`.
 */
export const GET = handler(async (request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const { id, studentId } = await context.params
  const subject = await findTeacherSubject(teacher._id, id)
  if (!isObjectId(studentId)) throw new HttpError(404, 'Student not found.')
  const student = await Student.findOne({ _id: studentId, classroom: { $in: subject.classrooms } }).populate('classroom').select('name rollNumber officialEmail classroom').lean()
  if (!student) throw new HttpError(404, 'This student is not in a class that takes this practical.')
  await rateLimit(`practical-report:teacher:${teacher._id}`, 30, 60)

  const experimentId = new URL(request.url).searchParams.get('experiment')
  const experiment = experimentId ? await findSubjectExperiment(subject._id, experimentId) : null
  const report = await buildPracticalReport({ subject, student, experimentId: experiment?._id, hideLocked: false })
  return NextResponse.json({ report })
})

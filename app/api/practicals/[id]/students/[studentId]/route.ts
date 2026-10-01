import { NextResponse } from 'next/server'
import { HttpError, handler, requireTeacher } from '@/lib/auth'
import { Experiment, PracticalSubmission, PracticeProblem, Student, classLabel, isObjectId } from '@/lib/models'
import { findTeacherSubject } from '@/lib/practicals'

type Context = { params: Promise<{ id: string; studentId: string }> }

/** GET /api/practicals/:id/students/:studentId — one student's submissions in this practical, newest first, with their code. */
export const GET = handler(async (_request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const { id, studentId } = await context.params
  const subject = await findTeacherSubject(teacher._id, id)
  if (!isObjectId(studentId)) throw new HttpError(404, 'Student not found.')
  const student = await Student.findOne({ _id: studentId, classroom: { $in: subject.classrooms } }).populate('classroom').select('name rollNumber officialEmail classroom').lean()
  if (!student) throw new HttpError(404, 'This student is not in a class that takes this practical.')

  const submissions = await PracticalSubmission.find({ subject: subject._id, student: student._id }).sort({ createdAt: -1 }).limit(300).lean()
  const [experiments, problems] = await Promise.all([
    Experiment.find({ subject: subject._id }).select('title order').lean(),
    PracticeProblem.find({ _id: { $in: submissions.map(s => s.problem).filter(Boolean) } }).select('title source').lean(),
  ])
  const experimentById = new Map(experiments.map(e => [String(e._id), e]))
  const problemById = new Map(problems.map(p => [String(p._id), p]))

  return NextResponse.json({
    student: { id: String(student._id), name: student.name || student.officialEmail || 'Student', rollNumber: student.rollNumber ?? '', classLabel: classLabel(student.classroom as { class?: string; branch?: string; division?: string } | null) },
    submissions: submissions.map(s => {
      const experiment = experimentById.get(String(s.experiment))
      const problem = s.problem ? problemById.get(String(s.problem)) : null
      return {
        id: String(s._id),
        experiment: experiment ? { id: String(experiment._id), order: experiment.order, title: experiment.title } : null,
        practice: problem ? { id: String(problem._id), title: problem.title, source: problem.source } : null,
        language: s.language,
        code: s.code,
        samplesPassed: s.samplesPassed,
        samplesTotal: s.samplesTotal,
        hiddenPassed: s.hiddenPassed,
        hiddenTotal: s.hiddenTotal,
        solved: s.solved,
        compileError: s.compileError ?? '',
        createdAt: s.createdAt,
      }
    }),
  })
})

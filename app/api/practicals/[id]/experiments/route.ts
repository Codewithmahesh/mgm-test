import { NextResponse } from 'next/server'
import { handler, readJson, requireTeacher } from '@/lib/auth'
import { Experiment } from '@/lib/models'
import { findTeacherSubject, problemInput, serializeProblem } from '@/lib/practicals'

type Context = { params: Promise<{ id: string }> }

/** POST /api/practicals/:id/experiments — adds an experiment (a coding problem) as the last level. */
export const POST = handler(async (request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const subject = await findTeacherSubject(teacher._id, (await context.params).id)
  const problem = problemInput(await readJson(request))
  const last = await Experiment.findOne({ subject: subject._id }).sort({ order: -1 }).select('order').lean()
  const experiment = await Experiment.create({ ...problem, subject: subject._id, teacher: teacher._id, order: (last?.order ?? 0) + 1 })
  return NextResponse.json({ experiment: { ...serializeProblem(experiment.toObject(), { withHidden: true }), order: experiment.order, poolSize: 0, aiPracticeCount: 0 } }, { status: 201 })
})

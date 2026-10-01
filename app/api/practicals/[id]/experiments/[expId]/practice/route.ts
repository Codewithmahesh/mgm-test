import { NextResponse } from 'next/server'
import { handler, readJson, requireTeacher } from '@/lib/auth'
import { PracticeProblem } from '@/lib/models'
import { findSubjectExperiment, findTeacherSubject, problemInput, serializeProblem } from '@/lib/practicals'

type Context = { params: Promise<{ id: string; expId: string }> }

/** POST /api/practicals/:id/experiments/:expId/practice — adds a problem to the experiment's practice pool. */
export const POST = handler(async (request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const { id, expId } = await context.params
  const subject = await findTeacherSubject(teacher._id, id)
  const experiment = await findSubjectExperiment(subject._id, expId)
  const problem = await PracticeProblem.create({ ...problemInput(await readJson(request)), experiment: experiment._id, subject: subject._id, source: 'faculty' })
  return NextResponse.json({ problem: serializeProblem(problem.toObject(), { withHidden: true }) }, { status: 201 })
})

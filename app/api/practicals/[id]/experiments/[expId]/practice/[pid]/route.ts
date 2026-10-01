import { NextResponse } from 'next/server'
import { HttpError, handler, readJson, requireTeacher } from '@/lib/auth'
import { PracticalSubmission, PracticeProblem, isObjectId } from '@/lib/models'
import { findSubjectExperiment, findTeacherSubject, problemInput, serializeProblem } from '@/lib/practicals'

type Context = { params: Promise<{ id: string; expId: string; pid: string }> }

async function load(context: Context) {
  const teacher = await requireTeacher()
  const { id, expId, pid } = await context.params
  const subject = await findTeacherSubject(teacher._id, id)
  const experiment = await findSubjectExperiment(subject._id, expId)
  const problem = isObjectId(pid) ? await PracticeProblem.findOne({ _id: pid, experiment: experiment._id }) : null
  if (!problem) throw new HttpError(404, 'Practice problem not found.')
  return problem
}

/** PATCH …/practice/:pid — edits a practice problem (faculty pool or AI-written). */
export const PATCH = handler(async (request: Request, context: Context) => {
  const problem = await load(context)
  problem.set(problemInput(await readJson(request)))
  await problem.save()
  return NextResponse.json({ problem: serializeProblem(problem.toObject(), { withHidden: true }) })
})

/** DELETE …/practice/:pid — removes a practice problem and its submissions. */
export const DELETE = handler(async (_request: Request, context: Context) => {
  const problem = await load(context)
  await PracticalSubmission.deleteMany({ problem: problem._id })
  await problem.deleteOne()
  return NextResponse.json({ ok: true })
})

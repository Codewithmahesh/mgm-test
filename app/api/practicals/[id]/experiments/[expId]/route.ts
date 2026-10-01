import { NextResponse } from 'next/server'
import { handler, readJson, requireTeacher } from '@/lib/auth'
import { Experiment, PracticalSubmission, PracticeProblem } from '@/lib/models'
import { findSubjectExperiment, findTeacherSubject, problemInput, serializeProblem } from '@/lib/practicals'

type Context = { params: Promise<{ id: string; expId: string }> }

async function load(context: Context) {
  const teacher = await requireTeacher()
  const { id, expId } = await context.params
  const subject = await findTeacherSubject(teacher._id, id)
  return { subject, experiment: await findSubjectExperiment(subject._id, expId) }
}

/** GET /api/practicals/:id/experiments/:expId — the experiment with its practice pool and the AI-written problems. */
export const GET = handler(async (_request: Request, context: Context) => {
  const { experiment } = await load(context)
  const practice = await PracticeProblem.find({ experiment: experiment._id }).sort({ createdAt: 1 }).lean()
  return NextResponse.json({
    experiment: { ...serializeProblem(experiment.toObject(), { withHidden: true }), order: experiment.order },
    pool: practice.filter(p => p.source === 'faculty').map(p => serializeProblem(p, { withHidden: true })),
    aiProblems: practice.filter(p => p.source === 'ai').map(p => ({ ...serializeProblem(p, { withHidden: true }), student: p.student ? String(p.student) : null })),
  })
})

/** PATCH /api/practicals/:id/experiments/:expId — edits the problem. Past results stay as they were graded. */
export const PATCH = handler(async (request: Request, context: Context) => {
  const { experiment } = await load(context)
  experiment.set(problemInput(await readJson(request)))
  await experiment.save()
  return NextResponse.json({ experiment: { ...serializeProblem(experiment.toObject(), { withHidden: true }), order: experiment.order } })
})

/** DELETE /api/practicals/:id/experiments/:expId — removes it (with its practice and submissions) and closes the gap in the order. */
export const DELETE = handler(async (_request: Request, context: Context) => {
  const { subject, experiment } = await load(context)
  await Promise.all([PracticeProblem.deleteMany({ experiment: experiment._id }), PracticalSubmission.deleteMany({ experiment: experiment._id })])
  await experiment.deleteOne()
  await Experiment.updateMany({ subject: subject._id, order: { $gt: experiment.order } }, { $inc: { order: -1 } })
  return NextResponse.json({ ok: true })
})

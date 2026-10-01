import { NextResponse } from 'next/server'
import { HttpError, handler, readJson, requireTeacher } from '@/lib/auth'
import { Experiment, PracticalSubmission, PracticeProblem } from '@/lib/models'
import { findTeacherSubject, serializeProblem } from '@/lib/practicals'
import { subjectSettings, withSubjectStats } from '@/lib/practical-subjects'

type Context = { params: Promise<{ id: string }> }

/** GET /api/practicals/:id — the subject and its experiments in order (with hidden tests and pool sizes). */
export const GET = handler(async (_request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const subject = await findTeacherSubject(teacher._id, (await context.params).id)
  const [experiments, pools] = await Promise.all([
    Experiment.find({ subject: subject._id }).sort({ order: 1 }).lean(),
    PracticeProblem.aggregate<{ _id: unknown; faculty: number; ai: number }>([
      { $match: { subject: subject._id } },
      { $group: { _id: '$experiment', faculty: { $sum: { $cond: [{ $eq: ['$source', 'faculty'] }, 1, 0] } }, ai: { $sum: { $cond: [{ $eq: ['$source', 'ai'] }, 1, 0] } } } },
    ]),
  ])
  const poolById = new Map(pools.map(p => [String(p._id), p]))
  const [summary] = await withSubjectStats([subject.toObject()])
  return NextResponse.json({
    subject: summary,
    experiments: experiments.map(e => ({
      ...serializeProblem(e, { withHidden: true }),
      order: e.order,
      poolSize: poolById.get(String(e._id))?.faculty ?? 0,
      aiPracticeCount: poolById.get(String(e._id))?.ai ?? 0,
    })),
  })
})

/** PATCH /api/practicals/:id — edit the subject, or reorder experiments with { order: [experimentIds] }. */
export const PATCH = handler(async (request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const subject = await findTeacherSubject(teacher._id, (await context.params).id)
  const body = await readJson(request)
  if (Array.isArray(body.order)) {
    const current = (await Experiment.find({ subject: subject._id }).select('_id').lean()).map(e => String(e._id))
    const order = body.order.map(String)
    if (order.length !== current.length || !current.every(id => order.includes(id))) throw new HttpError(400, 'The new order must list every experiment once.')
    await Experiment.bulkWrite(order.map((id: string, index: number) => ({ updateOne: { filter: { _id: id, subject: subject._id }, update: { $set: { order: index + 1 } } } })))
  }
  const settings = await subjectSettings(body, true)
  if (Object.keys(settings).length) { subject.set(settings); await subject.save() }
  const [summary] = await withSubjectStats([subject.toObject()])
  return NextResponse.json({ subject: summary })
})

/** DELETE /api/practicals/:id — deletes the subject with its experiments, practice problems and submissions. */
export const DELETE = handler(async (_request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const subject = await findTeacherSubject(teacher._id, (await context.params).id)
  await Promise.all([
    Experiment.deleteMany({ subject: subject._id }),
    PracticeProblem.deleteMany({ subject: subject._id }),
    PracticalSubmission.deleteMany({ subject: subject._id }),
  ])
  await subject.deleteOne()
  return NextResponse.json({ ok: true })
})

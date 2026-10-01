import { NextResponse } from 'next/server'
import type { Types } from 'mongoose'
import { handler, requireStudent } from '@/lib/auth'
import { Experiment, PracticalSubmission, Teacher } from '@/lib/models'
import { findStudentSubject, levels } from '@/lib/practicals'

type Context = { params: Promise<{ id: string }> }

/** GET /api/student/practicals/:id — the experiments as levels (solved / open / locked) with the student's results. */
export const GET = handler(async (_request: Request, context: Context) => {
  const student = await requireStudent()
  const subject = await findStudentSubject(student, (await context.params).id)
  const [experiments, rows, teacher] = await Promise.all([
    Experiment.find({ subject: subject._id }).select('title topic order hiddenTests').sort({ order: 1 }).lean(),
    PracticalSubmission.aggregate<{ _id: { experiment: Types.ObjectId; problem: Types.ObjectId | null }; attempts: number; solved: boolean; hiddenPassed: number; hiddenTotal: number; solvedAt: Date | null }>([
      { $match: { subject: subject._id, student: student._id } },
      { $sort: { createdAt: 1 } },
      { $group: { _id: { experiment: '$experiment', problem: '$problem' }, attempts: { $sum: 1 }, solved: { $max: '$solved' }, hiddenPassed: { $max: '$hiddenPassed' }, hiddenTotal: { $last: '$hiddenTotal' }, solvedAt: { $min: { $cond: ['$solved', '$createdAt', null] } } } },
    ]),
    Teacher.findById(subject.teacher).select('name').lean(),
  ])
  const main = new Map(rows.filter(r => !r._id.problem).map(r => [String(r._id.experiment), r]))
  const practiceSolved = (experimentId: string) => rows.filter(r => r._id.problem && String(r._id.experiment) === experimentId && r.solved).length
  const solved = new Set([...main].filter(([, r]) => r.solved).map(([id]) => id))

  return NextResponse.json({
    subject: { id: String(subject._id), title: subject.title, code: subject.code ?? '', description: subject.description ?? '', faculty: teacher?.name ?? '' },
    experiments: levels(experiments, solved).map(({ experiment, status }) => {
      const result = main.get(String(experiment._id))
      return {
        id: String(experiment._id),
        order: experiment.order,
        // A locked level shows only its number, not what's in it.
        title: status === 'locked' ? '' : experiment.title,
        topic: status === 'locked' ? '' : experiment.topic ?? '',
        status,
        attempts: result?.attempts ?? 0,
        solvedAt: result?.solvedAt ?? null,
        hiddenPassed: result ? result.hiddenPassed : null,
        hiddenTotal: result ? result.hiddenTotal : (experiment.hiddenTests?.length ?? 0),
        practiceSolved: practiceSolved(String(experiment._id)),
      }
    }),
  })
})

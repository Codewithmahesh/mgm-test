import { NextResponse } from 'next/server'
import { HttpError, handler, requireStudent } from '@/lib/auth'
import { Experiment, PracticalSubmission, PracticeProblem, isObjectId } from '@/lib/models'
import { experimentStatus, findStudentSubject, serializeProblem } from '@/lib/practicals'

type Context = { params: Promise<{ id: string; expId: string }> }

/**
 * GET /api/student/practicals/:id/experiments/:expId[?problem=practiceId] — the experiment (or one of its
 * practice problems) to solve, without hidden tests, plus the student's last code, recent results and the
 * practice problems available: the faculty pool, then the student's own AI-written ones.
 * A locked experiment (an earlier one isn't solved yet) can be read but not solved: its status is
 * "locked" and it comes without practice problems.
 */
export const GET = handler(async (request: Request, context: Context) => {
  const student = await requireStudent()
  const { id, expId } = await context.params
  const subject = await findStudentSubject(student, id)
  if (!isObjectId(expId)) throw new HttpError(404, 'Experiment not found.')
  const experiment = await Experiment.findOne({ _id: expId, subject: subject._id }).lean()
  if (!experiment) throw new HttpError(404, 'Experiment not found.')
  const status = await experimentStatus(subject._id, experiment._id, student._id)

  const problemId = new URL(request.url).searchParams.get('problem')
  if (problemId && status === 'locked') throw new HttpError(403, 'Solve the earlier experiments first. Each one unlocks when all its sample tests pass.')
  const practice = await PracticeProblem.find({ experiment: experiment._id, $or: [{ source: 'faculty' }, { source: 'ai', student: student._id }] }).sort({ source: -1, createdAt: 1 }).lean()
  const current = problemId ? practice.find(p => String(p._id) === problemId) : null
  if (problemId && !current) throw new HttpError(404, 'Practice problem not found.')

  const [history, practiceResults] = await Promise.all([
    PracticalSubmission.find({ experiment: experiment._id, student: student._id, problem: current?._id ?? null }).sort({ createdAt: -1 }).limit(10).lean(),
    PracticalSubmission.aggregate<{ _id: unknown; solved: boolean; attempts: number }>([
      { $match: { experiment: experiment._id, student: student._id, problem: { $ne: null } } },
      { $group: { _id: '$problem', solved: { $max: '$solved' }, attempts: { $sum: 1 } } },
    ]),
  ])
  const resultByProblem = new Map(practiceResults.map(r => [String(r._id), r]))
  const pool = practice.filter(p => p.source === 'faculty')

  return NextResponse.json({
    subject: { id: String(subject._id), title: subject.title, code: subject.code ?? '' },
    experiment: { id: String(experiment._id), order: experiment.order, title: experiment.title, status },
    problem: serializeProblem(current ?? experiment, { withHidden: false }),
    practiceProblem: current ? { id: String(current._id), source: current.source } : null,
    lastCode: history[0] ? { language: history[0].language, code: history[0].code } : null,
    history: history.map(s => ({ id: String(s._id), language: s.language, samplesPassed: s.samplesPassed, samplesTotal: s.samplesTotal, hiddenPassed: s.hiddenPassed, hiddenTotal: s.hiddenTotal, solved: s.solved, compileError: s.compileError ?? '', createdAt: s.createdAt })),
    practice: status === 'locked' ? [] : practice.map(p => ({ id: String(p._id), title: p.title, source: p.source, solved: resultByProblem.get(String(p._id))?.solved ?? false, attempts: resultByProblem.get(String(p._id))?.attempts ?? 0 })),
    // AI practice opens once every problem in the faculty's pool is solved.
    canGenerate: status !== 'locked' && pool.every(p => resultByProblem.get(String(p._id))?.solved),
  })
})

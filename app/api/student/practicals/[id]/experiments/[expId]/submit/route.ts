import { NextResponse } from 'next/server'
import { HttpError, handler, rateLimit, readJson, requireStudent } from '@/lib/auth'
import { Experiment, PracticalSubmission, PracticeProblem, isObjectId } from '@/lib/models'
import { assertUnlocked, findStudentSubject, gradeProblem } from '@/lib/practicals'

export const maxDuration = 120

type Context = { params: Promise<{ id: string; expId: string }> }

/**
 * POST /api/student/practicals/:id/experiments/:expId/submit { language, code, problem? } — the server runs
 * the code on the sample and hidden tests and records the submission. Passing every sample solves the
 * experiment (and unlocks the next one); hidden tests only add to the score the faculty sees.
 */
export const POST = handler(async (request: Request, context: Context) => {
  const student = await requireStudent()
  const { id, expId } = await context.params
  const subject = await findStudentSubject(student, id)
  if (!isObjectId(expId)) throw new HttpError(404, 'Experiment not found.')
  const experiment = await Experiment.findOne({ _id: expId, subject: subject._id }).lean()
  if (!experiment) throw new HttpError(404, 'Experiment not found.')
  await assertUnlocked(subject._id, experiment._id, student._id)
  await rateLimit(`practical-submit:${student._id}`, 30, 60)

  const body = await readJson(request)
  const problemId = body.problem ? String(body.problem) : null
  const practice = problemId
    ? (isObjectId(problemId) ? await PracticeProblem.findOne({ _id: problemId, experiment: experiment._id, $or: [{ source: 'faculty' }, { source: 'ai', student: student._id }] }).lean() : null)
    : null
  if (problemId && !practice) throw new HttpError(404, 'Practice problem not found.')

  const language = String(body.language ?? '')
  const code = String(body.code ?? '')
  const result = await gradeProblem(practice ?? experiment, language, code)
  const wasSolved = !practice && Boolean(await PracticalSubmission.exists({ experiment: experiment._id, student: student._id, problem: null, solved: true }))
  const submission = await PracticalSubmission.create({
    subject: subject._id, experiment: experiment._id, problem: practice?._id ?? null, student: student._id, language, code,
    samplesPassed: result.samplesPassed, samplesTotal: result.samplesTotal, hiddenPassed: result.hiddenPassed, hiddenTotal: result.hiddenTotal,
    solved: result.solved, compileError: result.compileError,
  })
  const next = !practice && result.solved && !wasSolved
    ? await Experiment.findOne({ subject: subject._id, order: { $gt: experiment.order } }).sort({ order: 1 }).select('title order').lean()
    : null

  return NextResponse.json({
    submission: { id: String(submission._id), createdAt: submission.createdAt },
    ...result,
    // Set when this submission just unlocked the next experiment.
    unlocked: next ? { id: String(next._id), order: next.order, title: next.title } : null,
  })
})

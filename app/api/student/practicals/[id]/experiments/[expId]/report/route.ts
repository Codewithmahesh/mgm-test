import { NextResponse } from 'next/server'
import { HttpError, handler, rateLimit, readJson, requireStudent } from '@/lib/auth'
import { Experiment, PracticeProblem, isObjectId } from '@/lib/models'
import { buildPracticalReport } from '@/lib/practical-report'
import { experimentStatus, findStudentSubject } from '@/lib/practicals'

export const maxDuration = 120

type Context = { params: Promise<{ id: string; expId: string }> }

/**
 * POST /api/student/practicals/:id/experiments/:expId/report { problem?, language?, code? } — the data for
 * this experiment's PDF: the latest submission, or the code in the editor when nothing was submitted yet.
 * A locked experiment prints its aim and tests only.
 */
export const POST = handler(async (request: Request, context: Context) => {
  const student = await requireStudent()
  const { id, expId } = await context.params
  const subject = await findStudentSubject(student, id)
  if (!isObjectId(expId)) throw new HttpError(404, 'Experiment not found.')
  const experiment = await Experiment.findOne({ _id: expId, subject: subject._id }).select('_id').lean()
  if (!experiment) throw new HttpError(404, 'Experiment not found.')
  const status = await experimentStatus(subject._id, experiment._id, student._id)
  await rateLimit(`practical-report:${student._id}`, 20, 60)

  const body = await readJson(request)
  const problemId = body.problem && status !== 'locked' ? String(body.problem) : null
  const practice = problemId
    ? (isObjectId(problemId) ? await PracticeProblem.findOne({ _id: problemId, experiment: experiment._id, $or: [{ source: 'faculty' }, { source: 'ai', student: student._id }] }).lean() : null)
    : null
  if (problemId && !practice) throw new HttpError(404, 'Practice problem not found.')
  const draft = { language: String(body.language ?? ''), code: String(body.code ?? '').slice(0, 50_000) }

  const report = await buildPracticalReport({ subject, student, experimentId: experiment._id, practice, draft, hideLocked: true })
  return NextResponse.json({ report })
})

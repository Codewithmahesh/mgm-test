import { NextResponse } from 'next/server'
import { HttpError, handler, rateLimit, readJson, requireStudent } from '@/lib/auth'
import { Experiment, PracticalSubmission, PracticeProblem, isObjectId } from '@/lib/models'
import { assertUnlocked, findStudentSubject, generateProblem, parseLevel, practicalContext } from '@/lib/practicals'

export const maxDuration = 120

type Context = { params: Promise<{ id: string; expId: string }> }

/** AI problems one student may ask for per day, across all practicals. */
const AI_PER_DAY = 15

/**
 * POST /api/student/practicals/:id/experiments/:expId/practice — "More like this": once the student has
 * solved every problem in the faculty's pool for this experiment, the AI writes a new one on the same
 * concept at the level they choose ({ level: easy | medium | hard }), kept for this student (and visible to the faculty).
 */
export const POST = handler(async (request: Request, context: Context) => {
  const student = await requireStudent()
  const { id, expId } = await context.params
  const subject = await findStudentSubject(student, id)
  if (!isObjectId(expId)) throw new HttpError(404, 'Experiment not found.')
  const experiment = await Experiment.findOne({ _id: expId, subject: subject._id }).lean()
  if (!experiment) throw new HttpError(404, 'Experiment not found.')
  await assertUnlocked(subject._id, experiment._id, student._id)

  const existing = await PracticeProblem.find({ experiment: experiment._id, $or: [{ source: 'faculty' }, { source: 'ai', student: student._id }] }).select('title source').lean()
  const pool = existing.filter(p => p.source === 'faculty')
  const solved = new Set((await PracticalSubmission.distinct('problem', { experiment: experiment._id, student: student._id, problem: { $ne: null }, solved: true })).map(String))
  if (pool.some(p => !solved.has(String(p._id)))) throw new HttpError(409, "Solve your faculty's practice problems for this experiment first. More open up after that.")
  await rateLimit(`practical-ai:student:${student._id}`, AI_PER_DAY, 24 * 60 * 60)

  const body = await readJson<{ level?: unknown }>(request).catch(() => ({ level: undefined }))
  const level = parseLevel(body.level)
  const problem = await generateProblem({ topic: experiment.topic || experiment.title, level, context: await practicalContext(subject), like: experiment, avoid: [experiment.title, ...existing.map(p => p.title)] })
  const saved = await PracticeProblem.create({ ...problem, experiment: experiment._id, subject: subject._id, source: 'ai', student: student._id })
  return NextResponse.json({ problem: { id: String(saved._id), title: saved.title } }, { status: 201 })
})

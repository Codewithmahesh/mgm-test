import { NextResponse } from 'next/server'
import { HttpError, handler, rateLimit, readJson, requireTeacher } from '@/lib/auth'
import { PracticeProblem } from '@/lib/models'
import { addGeneratedExperiment, findSubjectExperiment, findTeacherSubject, generateProblem, parseLevel, practicalContext, serializeProblem } from '@/lib/practicals'

export const maxDuration = 120

type Context = { params: Promise<{ id: string }> }

/**
 * POST /api/practicals/:id/generate { mode, topic?, description?, level, experiment? } — the AI writes a coding
 * problem with this practical (subject and existing experiments) as context, at level easy | medium | hard.
 *   mode "draft":      returns a draft experiment for the faculty member to review (not saved)
 *   mode "experiment": adds it as the last experiment (used when importing a practical list)
 *   mode "practice":   adds a practice problem like `experiment` to that experiment's pool
 */
export const POST = handler(async (request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const subject = await findTeacherSubject(teacher._id, (await context.params).id)
  const body = await readJson(request)
  const mode = String(body.mode ?? 'draft')
  const level = parseLevel(body.level)
  const topic = String(body.topic ?? '').trim().slice(0, 300)
  const description = String(body.description ?? '').trim().slice(0, 3000)
  await rateLimit(`practical-ai:teacher:${teacher._id}`, 80, 60 * 60)
  const ctx = await practicalContext(subject)

  if (mode === 'practice') {
    const experiment = await findSubjectExperiment(subject._id, String(body.experiment ?? ''))
    const existing = await PracticeProblem.find({ experiment: experiment._id }).select('title').lean()
    const problem = await generateProblem({ topic: experiment.topic || experiment.title, description, level, context: ctx, like: experiment.toObject(), avoid: [experiment.title, ...existing.map(p => p.title)] })
    const saved = await PracticeProblem.create({ ...problem, experiment: experiment._id, subject: subject._id, source: 'faculty' })
    return NextResponse.json({ problem: serializeProblem(saved.toObject(), { withHidden: true }) }, { status: 201 })
  }

  if (!topic && !description) throw new HttpError(400, 'Enter the experiment topic or its aim first.')
  if (mode !== 'experiment') return NextResponse.json({ problem: await generateProblem({ topic, description, level, context: ctx, avoid: ctx.experiments.map(e => e.title) }) })

  const experiment = await addGeneratedExperiment(subject, teacher._id, { topic, description, level })
  return NextResponse.json({ experiment: { ...serializeProblem(experiment.toObject(), { withHidden: true }), order: experiment.order, poolSize: 0, aiPracticeCount: 0 } }, { status: 201 })
})

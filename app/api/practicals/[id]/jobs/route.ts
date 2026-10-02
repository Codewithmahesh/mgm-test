import { NextResponse, after } from 'next/server'
import { HttpError, handler, rateLimit, readJson, requireTeacher } from '@/lib/auth'
import { PracticalJob } from '@/lib/models'
import { createPracticalJob, practicalJobView, processPracticalJob } from '@/lib/practical-jobs'
import { findTeacherSubject, parseLevel } from '@/lib/practicals'

export const maxDuration = 300

type Context = { params: Promise<{ id: string }> }

/** GET /api/practicals/:id/jobs — this practical's background AI jobs: running ones, and finished ones not yet dismissed. */
export const GET = handler(async (_request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const subject = await findTeacherSubject(teacher._id, (await context.params).id)
  const jobs = await PracticalJob.find({ subject: subject._id, teacher: teacher._id, status: { $ne: 'cancelled' }, dismissed: false }).sort({ createdAt: -1 }).limit(10).lean()
  return NextResponse.json({ jobs: jobs.map(practicalJobView) })
})

/**
 * POST /api/practicals/:id/jobs { kind: 'import' | 'draft', level, items: [{ title, description }] } — the AI
 * writes these experiments in the background and adds them in order; the faculty member is emailed when it
 * starts and when it finishes.
 */
export const POST = handler(async (request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const subject = await findTeacherSubject(teacher._id, (await context.params).id)
  const body = await readJson(request)
  if (!Array.isArray(body.items)) throw new HttpError(400, 'Choose at least one experiment to write.')
  await rateLimit(`practical-job:teacher:${teacher._id}`, 20, 60 * 60)
  const job = await createPracticalJob({
    teacher: teacher._id,
    subject,
    kind: body.kind === 'draft' ? 'draft' : 'import',
    level: parseLevel(body.level),
    items: (body.items as Record<string, unknown>[]).map(i => ({ title: String(i?.title ?? ''), description: String(i?.description ?? '') })),
  })
  // Start right away where the platform allows it; the scheduler picks up whatever is left.
  after(() => processPracticalJob(job._id, Date.now() + 270_000).catch(error => console.error('[practical-job] background run failed:', error)))
  return NextResponse.json({ job: practicalJobView(job) }, { status: 201 })
})

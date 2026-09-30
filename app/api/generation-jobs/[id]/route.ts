import { NextResponse, after } from 'next/server'
import { HttpError, handler, readJson, requireTeacher } from '@/lib/auth'
import { jobSummary, processJob } from '@/lib/generation-jobs'
import { ExamRoom, GenerationJob, isObjectId } from '@/lib/models'

export const maxDuration = 300

type Context = { params: Promise<{ id: string }> }

async function load(context: Context) {
  const teacher = await requireTeacher()
  const id = (await context.params).id
  if (!isObjectId(id)) throw new HttpError(404, 'That generation no longer exists.')
  const job = await GenerationJob.findOne({ _id: id, teacher: teacher._id }).select('-files -parts.questions')
  if (!job) throw new HttpError(404, 'That generation no longer exists.')
  const room = job.room ? await ExamRoom.findById(job.room).select('title code').lean() : null
  return { job, room }
}

/** GET — progress, and once ready the drafts and the plan to review them with. */
export const GET = handler(async (_request: Request, context: Context) => {
  const { job, room } = await load(context)
  if (job.status === 'running' && !job.background) await GenerationJob.updateOne({ _id: job._id }, { lastSeenAt: new Date() })
  return NextResponse.json({
    job: jobSummary(job, room),
    ...(job.status === 'ready' ? { questions: job.result, plan: job.plan } : {}),
  })
})

/**
 * PATCH { action: 'background' } — stop waiting: the server finishes it and emails the faculty member.
 * PATCH { action: 'saved' } — the drafts were reviewed and saved; hide the job.
 */
export const PATCH = handler(async (request: Request, context: Context) => {
  const { job, room } = await load(context)
  const body = await readJson(request)
  if (body.action === 'background') {
    if (job.status !== 'running') throw new HttpError(409, 'This generation has already finished.')
    job.background = true
    await job.save()
    // Start right away where the platform allows it; the scheduler picks up whatever is left.
    after(() => processJob(job._id, Date.now() + 270_000).catch(error => console.error('[generation] background run failed:', error)))
  } else if (body.action === 'saved') {
    job.status = 'saved'
    job.result = []
    // The "questions added" email covers it now.
    job.notifiedAt ??= new Date()
    await job.save()
  } else throw new HttpError(400, 'Unknown action.')
  return NextResponse.json({ job: jobSummary(job, room) })
})

/** DELETE — cancel a running generation or dismiss a finished one. */
export const DELETE = handler(async (_request: Request, context: Context) => {
  const { job } = await load(context)
  await job.deleteOne()
  return NextResponse.json({ ok: true })
})

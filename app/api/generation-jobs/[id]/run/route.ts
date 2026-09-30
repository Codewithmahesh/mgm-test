import { NextResponse } from 'next/server'
import { HttpError, handler, requireTeacher } from '@/lib/auth'
import { jobSummary, runPart } from '@/lib/generation-jobs'
import { GenerationJob, isObjectId } from '@/lib/models'

export const maxDuration = 300

type Context = { params: Promise<{ id: string }> }

/**
 * POST /api/generation-jobs/:id/run — runs the next due part of a foreground job while the faculty
 * member watches. Returns the new questions (for the live preview), whether the AI was busy, and progress.
 */
export const POST = handler(async (_request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const id = (await context.params).id
  if (!isObjectId(id)) throw new HttpError(404, 'That generation no longer exists.')
  const found = await GenerationJob.findOneAndUpdate({ _id: id, teacher: teacher._id }, { lastSeenAt: new Date() }).select('background status')
  if (!found) throw new HttpError(404, 'That generation no longer exists.')

  const run = found.status === 'running' && !found.background ? await runPart(found._id) : { claimed: false, busy: false, questions: [], error: '' }
  const job = await GenerationJob.findById(found._id).select('-files -result -parts.questions').lean()
  if (!job) throw new HttpError(404, 'That generation was cancelled.')
  return NextResponse.json({ ...run, job: jobSummary(job) })
})

import { NextResponse } from 'next/server'
import { HttpError, handler, requireTeacher } from '@/lib/auth'
import { PracticalJob, isObjectId } from '@/lib/models'
import { findTeacherSubject } from '@/lib/practicals'

type Context = { params: Promise<{ id: string; jobId: string }> }

/** DELETE /api/practicals/:id/jobs/:jobId — stop a running job (experiments already added stay) or dismiss a finished one. */
export const DELETE = handler(async (_request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const { id, jobId } = await context.params
  const subject = await findTeacherSubject(teacher._id, id)
  if (!isObjectId(jobId)) throw new HttpError(404, 'That job no longer exists.')
  const job = await PracticalJob.findOne({ _id: jobId, subject: subject._id, teacher: teacher._id })
  if (!job) throw new HttpError(404, 'That job no longer exists.')
  if (job.status === 'running') {
    job.status = 'cancelled'
    job.finishedAt = new Date()
  }
  job.dismissed = true
  await job.save()
  return NextResponse.json({ ok: true })
})

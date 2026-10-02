import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Types } from 'mongoose'
import { HttpError } from './auth'
import { connectDb } from './db'
import { formatWhen, renderEmail } from './email-template'
import { sendMail } from './mail'
import { PracticalJob, PracticalSubject, Teacher } from './models'
import { addGeneratedExperiment, parseLevel, type ProblemLevel } from './practicals'

// The AI writing experiments for a practical in the background, so the faculty member doesn't have to keep
// the page open: an imported practical list, or a single experiment from a topic. Items are written and
// added one at a time and in order (each becomes the next experiment), retrying when the AI is busy.
// The faculty member is emailed when it starts and again when everything is done.
// It runs right after it is created (where the platform allows) and from the scheduler every minute
// (instrumentation.ts on a long-running server, GET /api/cron/schedule on serverless hosts).

export const MAX_JOB_ITEMS = 60
// A claimed item nobody finished in this time (the server was stopped mid-call) is run again.
const STALE_CLAIM_MS = 6 * 60_000
const MAX_BUSY_ATTEMPTS = 10 // with delays of 1, 2, 4, 8, 15, 15… minutes: about 1.5 hours
const MAX_ERROR_ATTEMPTS = 3

const busyError = (error: unknown) => error instanceof HttpError && (error.status === 503 || error.status === 429)
const messageOf = (error: unknown) => (error instanceof HttpError ? error.message : 'The AI service failed unexpectedly.')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const LEVEL_LABEL: Record<ProblemLevel, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

const loadJob = (id: Types.ObjectId | string) => PracticalJob.findById(id)
type JobDoc = NonNullable<Awaited<ReturnType<typeof loadJob>>>
type Subject = { _id: Types.ObjectId; title: string; code?: string | null; description?: string | null }

/** Saves a background job and emails the faculty member that it has started. Run it with `processPracticalJob`. */
export async function createPracticalJob({ teacher, subject, kind, level, items }: {
  teacher: Types.ObjectId
  subject: Subject
  kind: 'import' | 'draft'
  level: ProblemLevel
  items: { title: string; description: string }[]
}) {
  const clean = items
    .map(i => ({ title: i.title.trim().slice(0, 300), description: i.description.trim().slice(0, 3000) }))
    .filter(i => i.title || i.description)
  if (!clean.length) throw new HttpError(400, 'Choose at least one experiment to write.')
  if (clean.length > MAX_JOB_ITEMS) throw new HttpError(400, `Write at most ${MAX_JOB_ITEMS} experiments at a time.`)
  const job = await PracticalJob.create({ teacher, subject: subject._id, kind, level, items: clean })
  try { await notifyStarted(job, subject) } catch (error) { console.error('[practical-job] start email failed:', error) }
  return job
}

/**
 * Claims the next item, in list order, and writes it. `claimed: false` means nothing is due now (the job is
 * finished, an earlier item is still being written, or the next one is waiting to retry).
 */
export async function runNextItem(jobId: Types.ObjectId | string) {
  const job = await PracticalJob.findById(jobId)
  if (!job || job.status !== 'running') return { claimed: false }
  const index = job.items.findIndex(i => i.status === 'pending' || i.status === 'running')
  if (index < 0) { await finalizeIfDone(job._id); return { claimed: false } }
  const item = job.items[index]
  if (item.status === 'running' || (item.retryAt && item.retryAt.getTime() > Date.now())) return { claimed: false }

  const claim = randomUUID()
  const claimed = await PracticalJob.updateOne(
    { _id: job._id, status: 'running', [`items.${index}.status`]: 'pending', [`items.${index}.claim`]: '' },
    { $set: { [`items.${index}.status`]: 'running', [`items.${index}.claim`]: claim, [`items.${index}.claimedAt`]: new Date() } },
  )
  if (!claimed.modifiedCount) return { claimed: false }

  const at = (field: string) => `items.${index}.${field}`
  try {
    const subject = await PracticalSubject.findById(job.subject).lean()
    if (!subject) throw new HttpError(404, 'The practical was deleted.')
    // Cancelled while waiting for the claim: don't add anything.
    if ((await PracticalJob.findById(job._id).select('status').lean())?.status !== 'running') return { claimed: true }
    const experiment = await addGeneratedExperiment(subject, job.teacher, { topic: item.title, description: item.description, level: parseLevel(job.level) })
    await PracticalJob.updateOne({ _id: job._id, [at('claim')]: claim }, { $set: { [at('status')]: 'done', [at('experiment')]: experiment._id, [at('order')]: experiment.order, [at('title')]: experiment.title, [at('error')]: '', [at('claim')]: '' } })
  } catch (error) {
    const busy = busyError(error)
    const attempts = item.attempts + 1
    // Bad input won't get better by trying again.
    const permanent = !busy && error instanceof HttpError && error.status >= 400 && error.status < 500
    const giveUp = permanent || attempts >= (busy ? MAX_BUSY_ATTEMPTS : MAX_ERROR_ATTEMPTS)
    const delay = busy ? Math.min(15, 2 ** (attempts - 1)) * 60_000 : 30_000
    if (!(error instanceof HttpError)) console.error('[practical-job] item failed:', error)
    await PracticalJob.updateOne({ _id: job._id, [at('claim')]: claim }, {
      $set: { [at('status')]: giveUp ? 'failed' : 'pending', [at('attempts')]: attempts, [at('retryAt')]: new Date(Date.now() + delay), [at('error')]: messageOf(error), [at('claim')]: '' },
    })
  }
  await finalizeIfDone(job._id)
  return { claimed: true }
}

/** Once every item is written or has failed: mark the job finished and email the faculty member (once). */
async function finalizeIfDone(jobId: Types.ObjectId) {
  const job = await PracticalJob.findOneAndUpdate(
    { _id: jobId, status: 'running', 'items.status': { $nin: ['pending', 'running'] } },
    { $set: { status: 'finished', finishedAt: new Date() } },
    { returnDocument: 'after' },
  )
  if (!job) return
  const claimed = await PracticalJob.findOneAndUpdate({ _id: job._id, notifiedAt: null }, { notifiedAt: new Date() })
  if (!claimed) return
  try { await notifyFinished(job) } catch (error) {
    console.error('[practical-job] finish email failed:', error)
    await PracticalJob.updateOne({ _id: job._id }, { notifiedAt: null })
  }
}

/** Writes a job's items one after another until none is due or the deadline passes. */
export async function processPracticalJob(jobId: Types.ObjectId | string, deadline: number) {
  await connectDb()
  while (Date.now() < deadline) {
    const { claimed } = await runNextItem(jobId)
    if (!claimed) return
  }
}

/** Background work for every running job. Safe to run from several places at once. */
export async function runPracticalJobsTick(budgetMs: number) {
  await connectDb()
  const now = Date.now()
  await PracticalJob.updateMany(
    { status: 'running', items: { $elemMatch: { status: 'running', claimedAt: { $lt: new Date(now - STALE_CLAIM_MS) } } } },
    { $set: { 'items.$[i].status': 'pending', 'items.$[i].claim': '' } },
    { arrayFilters: [{ 'i.status': 'running', 'i.claimedAt': { $lt: new Date(now - STALE_CLAIM_MS) } }] },
  )
  // A finished job whose email failed earlier.
  const unsent = await PracticalJob.find({ status: 'finished', notifiedAt: null }).select('_id').lean()
  for (const { _id } of unsent) await finalizeOrNotify(_id)
  const jobs = await PracticalJob.find({ status: 'running' }).select('_id').sort({ createdAt: 1 }).lean()
  for (const { _id } of jobs) {
    if (Date.now() > now + budgetMs) break
    await processPracticalJob(_id, now + budgetMs)
  }
  return { practicalJobs: jobs.length }
}

async function finalizeOrNotify(jobId: Types.ObjectId) {
  const job = await PracticalJob.findOneAndUpdate({ _id: jobId, status: 'finished', notifiedAt: null }, { notifiedAt: new Date() }, { returnDocument: 'after' })
  if (!job) return
  try { await notifyFinished(job) } catch (error) {
    console.error('[practical-job] finish email failed:', error)
    await PracticalJob.updateOne({ _id: job._id }, { notifiedAt: null })
  }
}

/** What the faculty UI shows for a job. */
export function practicalJobView(job: JobDoc | Record<string, unknown>) {
  const j = job as JobDoc
  const items = j.items ?? []
  const waiting = items.filter(i => i.status === 'pending' && i.retryAt && i.retryAt.getTime() > Date.now() && i.attempts > 0)
  return {
    id: String(j._id),
    kind: j.kind,
    status: j.status,
    level: j.level,
    total: items.length,
    done: items.filter(i => i.status === 'done').length,
    failed: items.filter(i => i.status === 'failed').length,
    current: items.find(i => i.status === 'running' || i.status === 'pending')?.title ?? '',
    // When the AI was busy: when the next try is due, and why.
    nextRetryAt: waiting.length ? waiting[0].retryAt!.toISOString() : null,
    lastError: waiting[0]?.error ?? '',
    items: items.map(i => ({ title: i.title, status: i.status, error: i.status === 'failed' ? i.error : '', order: i.order ?? null })),
    createdAt: j.createdAt,
    finishedAt: j.finishedAt ?? null,
  }
}

const practicalPath = (subjectId: unknown) => `/teacher/practicals/${subjectId}`
const subjectName = (s: { title: string; code?: string | null }) => (s.code ? `${s.title} (${s.code})` : s.title)

async function notifyStarted(job: JobDoc, subject: Subject) {
  const teacher = await Teacher.findById(job.teacher).select('name email').lean()
  if (!teacher) return
  const count = job.items.length
  const what = job.kind === 'draft' && count === 1 ? `the experiment "${job.items[0].title || 'from your instructions'}"` : plural(count, 'experiment')
  await sendMail({
    to: teacher.email,
    subject: `Writing ${what} for ${subject.title}`,
    ...renderEmail({
      preview: `The AI is writing ${what} in the background. We'll email you when it's done.`,
      tag: 'Generation started',
      heading: 'Your experiments are being written',
      greeting: `Hi ${teacher.name},`,
      paragraphs: [
        `The AI has started writing ${what}, each with its problem statement, sample tests and hidden tests. They are added to the practical one by one, in order, as they are ready.`,
        "You don't need to keep the page open. We'll email you again when it's finished.",
      ],
      details: [['Practical', subjectName(subject)], ['Experiments', String(count)], ['Level', LEVEL_LABEL[parseLevel(job.level)]], ['Started', formatWhen(job.createdAt)]],
      lists: count > 1 ? [{ title: 'Experiments to write', tone: 'info', items: job.items.slice(0, 30).map((i, n) => `${n + 1}. ${i.title || i.description.slice(0, 80)}`) }] : undefined,
      button: { label: 'Open the practical', path: practicalPath(subject._id) },
    }),
  })
}

async function notifyFinished(job: JobDoc) {
  const [teacher, subject] = await Promise.all([
    Teacher.findById(job.teacher).select('name email').lean(),
    PracticalSubject.findById(job.subject).select('title code').lean(),
  ])
  if (!teacher || !subject) return
  const done = job.items.filter(i => i.status === 'done')
  const failed = job.items.filter(i => i.status === 'failed')
  const ok = done.length > 0
  await sendMail({
    to: teacher.email,
    subject: ok ? `${plural(done.length, 'experiment')} added to ${subject.title}` : `We couldn't write the experiments for ${subject.title}`,
    ...renderEmail({
      preview: ok ? `${plural(done.length, 'experiment')} ${done.length === 1 ? 'is' : 'are'} ready in ${subject.title}.` : 'The AI could not write the experiments this time.',
      tag: ok ? 'Experiments added' : 'Generation failed',
      heading: ok ? (failed.length ? 'Most of your experiments are ready' : 'Your experiments are ready') : "We couldn't write your experiments",
      greeting: `Hi ${teacher.name},`,
      paragraphs: ok
        ? [`The AI finished writing ${plural(done.length, 'experiment')}, and ${done.length === 1 ? 'it has' : 'they have'} been added to the practical. Students see ${done.length === 1 ? 'it' : 'them'} right away, so review the statements and tests and edit anything you'd like to change.`]
        : ['We kept trying in the background, but the AI could not write the experiments. Please try again in a while.'],
      details: [['Practical', subjectName(subject)], ['Added', `${done.length} of ${job.items.length}`], ['Started', formatWhen(job.createdAt)], ['Finished', formatWhen(job.finishedAt ?? new Date())]],
      lists: [
        ...(done.length ? [{ title: 'Added', tone: 'good' as const, items: done.slice(0, 30).map(i => `Experiment ${i.order}: ${i.title}`) }] : []),
        ...(failed.length ? [{ title: 'Not added', tone: 'bad' as const, items: failed.slice(0, 30).map(i => `${i.title || 'Untitled'}: ${i.error || 'the AI failed'}`) }] : []),
      ],
      callout: failed.length && ok ? { tone: 'warn', text: `${plural(failed.length, 'experiment')} could not be written. You can add ${failed.length === 1 ? 'it' : 'them'} again from the practical page.` } : undefined,
      button: { label: ok ? 'Review the experiments' : 'Open the practical', path: practicalPath(subject._id) },
    }),
  })
}

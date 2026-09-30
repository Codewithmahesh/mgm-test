import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Types } from 'mongoose'
import { HttpError } from './auth'
import { dealIntoSets, type BloomLevel } from './bloom'
import { connectDb } from './db'
import { formatWhen, renderEmail } from './email-template'
import { generateBatch } from './generate'
import { sendMail } from './mail'
import { ExamRoom, GenerationJob, Teacher } from './models'
import { toDraft } from './questions'
import type { SourceFile } from './source-files'

// AI question generation as a job. A request is split into parts (one AI call each) and saved in the
// database, so it can run in two ways:
//  - foreground: the faculty member's browser calls POST /api/generation-jobs/:id/run while they watch;
//  - background: the server runs the parts itself (after the faculty member chose to stop waiting, when
//    the AI was too busy, or when their browser went away), retrying busy calls with growing delays,
//    and emails them when the drafts are ready to review.
// The background work runs from instrumentation.ts on a long-running server and from
// GET /api/cron/schedule on serverless hosts; switching a job to the background also starts it right away.

export const MAX_SETS = 20
export const MAX_TOTAL_MCQ = 1000
export const MAX_TOTAL_CODING = 100
// Questions per AI call (lib/generate.ts allows up to 120 MCQs and 12 coding problems) and calls at once per job.
const MCQ_PER_PART = 60
const CODING_PER_PART = 10
const PARALLEL_PARTS = 4
// A claimed part nobody finished in this time (the server was stopped mid-call) is run again.
const STALE_CLAIM_MS = 6 * 60_000
// A foreground job whose browser stopped checking in for this long is finished in the background.
const ABANDONED_MS = 3 * 60_000
const MAX_BUSY_ATTEMPTS = 10 // with delays of 1, 2, 4, 8, 15, 15… minutes: about 1.5 hours
const MAX_ERROR_ATTEMPTS = 3
// Drafts from a job the faculty member watched but didn't save within this time (they closed the tab…)
// are announced by email too, so they aren't forgotten.
const UNSAVED_NOTICE_MS = 3 * 60_000

const loadJob = (id: Types.ObjectId | string) => GenerationJob.findById(id)
type JobDoc = NonNullable<Awaited<ReturnType<typeof loadJob>>>
type Draft = ReturnType<typeof toDraft>
export type GenerationPlan = { sets: string[]; mcqPerSet: number; codingPerSet: number; bloomPlan: unknown; applyToRoom: boolean }

const busyError = (error: unknown) => error instanceof HttpError && (error.status === 503 || error.status === 429)
const messageOf = (error: unknown) => (error instanceof HttpError ? error.message : 'The AI service failed unexpectedly.')

export async function createJob({ teacher, room, title, topic, description, sourceText, files, levels, singleLevel, codingPerSet, sets, plan }: {
  teacher: Types.ObjectId
  room: Types.ObjectId | null
  title: string
  topic: string
  description: string
  sourceText: string
  files: SourceFile[]
  /** MCQs per set at each Bloom level. */
  levels: number[]
  singleLevel: BloomLevel | null
  codingPerSet: number
  sets: number
  plan: GenerationPlan
}) {
  if (!topic && !sourceText && !files.length && !description) throw new HttpError(400, 'Add a topic, description, paste content, or upload a file first.')
  if (sets < 1 || sets > MAX_SETS) throw new HttpError(400, `Choose between 2 and ${MAX_SETS} sets.`)
  const totals = levels.map(n => n * sets)
  const totalMcq = totals.reduce((a, b) => a + b, 0)
  const totalCoding = codingPerSet * sets
  if (totalMcq + totalCoding === 0) throw new HttpError(400, 'Ask for at least one MCQ or coding problem.')
  if (totalMcq > MAX_TOTAL_MCQ) throw new HttpError(400, `That is ${totalMcq} MCQs in total; generate at most ${MAX_TOTAL_MCQ} at a time (fewer sets or fewer questions per set).`)
  if (totalCoding > MAX_TOTAL_CODING) throw new HttpError(400, `That is ${totalCoding} coding problems in total; generate at most ${MAX_TOTAL_CODING} at a time.`)

  // Every part gets a share of each Bloom level and of the coding problems.
  const count = Math.max(1, Math.ceil(totalMcq / MCQ_PER_PART), Math.ceil(totalCoding / CODING_PER_PART))
  const share = (total: number, i: number) => Math.floor((total * (i + 1)) / count) - Math.floor((total * i) / count)
  const parts = Array.from({ length: count }, (_, i) => ({ index: i, levels: totals.map(total => share(total, i)), coding: share(totalCoding, i) }))

  return GenerationJob.create({
    teacher, room, title, plan, parts, files,
    input: { topic, description, sourceText, singleLevel, sets },
    requested: { mcq: totalMcq, coding: totalCoding },
  })
}

/** Claims the next part that is due and runs it. `claimed: false` means nothing is due right now. */
export async function runPart(jobId: Types.ObjectId | string) {
  const now = new Date()
  const claim = randomUUID()
  const job = await GenerationJob.findOneAndUpdate(
    { _id: jobId, status: 'running', parts: { $elemMatch: { status: 'pending', $or: [{ retryAt: null }, { retryAt: { $lte: now } }] } } },
    { $set: { 'parts.$.status': 'running', 'parts.$.claim': claim, 'parts.$.claimedAt': now } },
    { returnDocument: 'after' },
  )
  if (!job) return { claimed: false, busy: false, questions: [] as Draft[], error: '' }
  const part = job.parts.find(p => p.claim === claim)!

  try {
    const { mcqs, coding } = await generateBatch({
      topic: job.input?.topic ?? '', description: job.input?.description ?? '', sourceText: job.input?.sourceText ?? '',
      files: job.files.map(file => ({ name: file.name ?? '', data: file.data as Buffer })),
      levels: part.levels, singleLevel: (job.input?.singleLevel as BloomLevel | null) ?? null, codingCount: part.coding,
      sets: job.input?.sets ?? 1, part: part.index + 1, partCount: job.parts.length,
    })
    const questions = [...mcqs, ...coding].map(toDraft)
    await GenerationJob.updateOne({ _id: job._id, 'parts.claim': claim }, { $set: { 'parts.$.status': 'done', 'parts.$.questions': questions, 'parts.$.error': '' } })
    await finalizeIfDone(job._id)
    return { claimed: true, busy: false, questions, error: '' }
  } catch (error) {
    const busy = busyError(error)
    const attempts = part.attempts + 1
    // Bad input (an unreadable file…) won't get better by trying again.
    const permanent = !busy && error instanceof HttpError && error.status >= 400 && error.status < 500
    const giveUp = permanent || attempts >= (busy ? MAX_BUSY_ATTEMPTS : MAX_ERROR_ATTEMPTS)
    const delay = busy ? Math.min(15, 2 ** (attempts - 1)) * 60_000 : 30_000
    if (!(error instanceof HttpError)) console.error('[generation] part failed:', error)
    await GenerationJob.updateOne({ _id: job._id, 'parts.claim': claim }, {
      $set: { 'parts.$.status': giveUp ? 'failed' : 'pending', 'parts.$.attempts': attempts, 'parts.$.retryAt': new Date(Date.now() + delay), 'parts.$.error': messageOf(error), 'parts.$.claim': '' },
    })
    if (giveUp) await finalizeIfDone(job._id)
    return { claimed: true, busy, questions: [] as Draft[], error: messageOf(error) }
  }
}

/** Once no part is left to run: merge, de-duplicate and deal into sets, then tell a background job's owner. */
async function finalizeIfDone(jobId: Types.ObjectId) {
  const job = await GenerationJob.findById(jobId).select('-files')
  if (!job || job.status !== 'running' || job.parts.some(p => p.status === 'pending' || p.status === 'running')) return

  const parts = [...job.parts].sort((a, b) => a.index - b.index)
  // Separately generated parts can repeat a question; keep the first copy.
  const seen = new Set<string>()
  const unique = parts.flatMap(p => p.questions as Draft[]).filter(q => {
    const key = `${q.type}:${String(q.title || q.text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`
    return seen.has(key) ? false : (seen.add(key), true)
  })
  const sets = job.input?.sets ?? 1
  const label = (list: Draft[]) => (sets > 1 ? dealIntoSets(list, sets).map(({ question, set }) => ({ ...question, set })) : list.map(q => ({ ...q, set: '' })))
  const result = [...label(unique.filter(q => q.type !== 'coding')), ...label(unique.filter(q => q.type === 'coding'))]

  const failed = parts.filter(p => p.status === 'failed')
  const requested = (job.requested?.mcq ?? 0) + (job.requested?.coding ?? 0)
  const reason = failed.at(-1)?.error || 'The AI service failed.'
  const error = !failed.length ? '' : result.length ? `Only ${result.length} of ${requested} questions could be generated: ${reason}` : reason

  const finished = await GenerationJob.findOneAndUpdate(
    { _id: job._id, status: 'running' },
    { $set: { status: result.length ? 'ready' : 'failed', result, resultCount: result.length, error, finishedAt: new Date(), files: [], 'parts.$[].questions': [] } },
    { returnDocument: 'after' },
  )
  if (finished?.background) await claimAndNotify(finished._id)
}

/** Sends the "finished" email once, however many servers race to do it. */
async function claimAndNotify(jobId: Types.ObjectId) {
  const job = await GenerationJob.findOneAndUpdate({ _id: jobId, notifiedAt: null, status: { $in: ['ready', 'failed'] } }, { notifiedAt: new Date() }, { returnDocument: 'after' }).select('-files')
  if (!job) return
  try { await notifyFinished(job) } catch (error) {
    console.error('[generation] email failed:', error)
    await GenerationJob.updateOne({ _id: jobId }, { notifiedAt: null })
  }
}

async function notifyFinished(job: JobDoc) {
  const [teacher, room] = await Promise.all([
    Teacher.findById(job.teacher).select('name email').lean(),
    job.room ? ExamRoom.findById(job.room).select('title code').lean() : null,
  ])
  if (!teacher) return
  const questions = (job.result ?? []) as Draft[]
  const coding = questions.filter(q => q.type === 'coding').length
  const sets = (job.plan as GenerationPlan | null)?.sets ?? []
  const where = room ? `${room.title} (${room.code})` : 'Your question bank'
  const details: [string, string][] = [
    ['For', where],
    ...(job.title ? [['Source', job.title] as [string, string]] : []),
    ['Requested', formatWhen(job.createdAt)],
  ]

  if (job.status === 'ready') {
    await sendMail({
      to: teacher.email,
      subject: `Your AI questions are ready to review: ${job.title || where}`,
      ...renderEmail({
        preview: `${questions.length} questions are waiting for your review.`,
        tag: 'Questions generated',
        heading: 'Your questions are ready to review',
        greeting: `Hi ${teacher.name},`,
        paragraphs: [`The questions you asked the AI for are ready. Nothing has been added yet: review them, edit anything you like, then add them ${room ? 'to the room' : 'to your question bank'}.`],
        details: [['Generated', `${questions.length - coding} MCQs${coding ? ` + ${coding} coding problems` : ''}`], ...(sets.length ? [['Sets', sets.join(', ')] as [string, string]] : []), ...details],
        callout: job.error ? { tone: 'warn', text: job.error } : undefined,
        button: { label: 'Review questions', path: `/teacher/generations?review=${job._id}` },
        footnote: 'Unreviewed questions are kept for 30 days.',
      }),
    })
  } else {
    await sendMail({
      to: teacher.email,
      subject: `We couldn't generate your questions: ${job.title || where}`,
      ...renderEmail({
        preview: 'The AI could not generate your questions this time.',
        tag: 'Generation failed',
        heading: "We couldn't generate your questions",
        greeting: `Hi ${teacher.name},`,
        paragraphs: ["We kept trying in the background, but the AI couldn't produce your questions."],
        callout: { tone: 'warn', text: job.error || 'The AI service failed.' },
        details,
        button: { label: 'Try again', path: room ? `/teacher/rooms/${room._id}?tab=questions` : '/teacher/questions' },
      }),
    })
  }
}

/** Runs a job's due parts, several at once, until none are due or the deadline passes. */
export async function processJob(jobId: Types.ObjectId | string, deadline: number) {
  await connectDb()
  await Promise.all(Array.from({ length: PARALLEL_PARTS }, async () => {
    while (Date.now() < deadline) {
      const { claimed } = await runPart(jobId)
      if (!claimed) return
    }
  }))
}

/** Background work for every job the server owns. Safe to run from several places at once. */
export async function runGenerationTick(budgetMs: number) {
  await connectDb()
  const now = Date.now()
  await GenerationJob.updateMany(
    { status: 'running', parts: { $elemMatch: { status: 'running', claimedAt: { $lt: new Date(now - STALE_CLAIM_MS) } } } },
    { $set: { 'parts.$[p].status': 'pending', 'parts.$[p].claim': '' } },
    { arrayFilters: [{ 'p.status': 'running', 'p.claimedAt': { $lt: new Date(now - STALE_CLAIM_MS) } }] },
  )
  await GenerationJob.updateMany({ status: 'running', background: false, lastSeenAt: { $lt: new Date(now - ABANDONED_MS) } }, { background: true })
  const unsaved = await GenerationJob.find({ status: 'ready', notifiedAt: null, finishedAt: { $lt: new Date(now - UNSAVED_NOTICE_MS) } }).select('_id').lean()
  for (const { _id } of unsaved) await claimAndNotify(_id)
  const jobs = await GenerationJob.find({ status: 'running', background: true }).select('_id').sort({ createdAt: 1 }).lean()
  for (const { _id } of jobs) {
    if (Date.now() > now + budgetMs) break
    await processJob(_id, now + budgetMs)
    await finalizeIfDone(_id)
  }
  return { generationJobs: jobs.length }
}

/** What the faculty UI shows for a job (no files, no drafts). */
export function jobSummary(job: JobDoc | Record<string, unknown>, room?: { _id: unknown; title: string; code: string } | null) {
  const j = job as JobDoc
  const now = Date.now()
  const parts = j.parts ?? []
  const waiting = parts.filter(p => p.status === 'pending' && p.retryAt && p.retryAt.getTime() > now)
  const busyRetry = waiting.filter(p => p.attempts > 0).map(p => p.retryAt!.getTime())
  return {
    id: String(j._id),
    title: j.title ?? '',
    status: j.status,
    background: Boolean(j.background),
    room: room ? { id: String(room._id), title: room.title, code: room.code } : null,
    requested: { mcq: j.requested?.mcq ?? 0, coding: j.requested?.coding ?? 0 },
    sets: (j.plan as GenerationPlan | null)?.sets ?? [],
    progress: {
      total: parts.length,
      done: parts.filter(p => p.status === 'done').length,
      failed: parts.filter(p => p.status === 'failed').length,
      running: parts.filter(p => p.status === 'running').length,
      waiting: waiting.length,
    },
    // When the AI was busy: when the next try is due.
    nextRetryAt: busyRetry.length ? new Date(Math.min(...busyRetry)).toISOString() : null,
    lastError: parts.find(p => p.status === 'pending' && p.error)?.error ?? '',
    error: j.error ?? '',
    resultCount: j.resultCount ?? 0,
    createdAt: j.createdAt,
    finishedAt: j.finishedAt ?? null,
  }
}

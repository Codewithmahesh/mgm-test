import { NextResponse } from 'next/server'
import { HttpError, handler, rateLimit, requireTeacher } from '@/lib/auth'
import { BLOOM_LEVELS, setNames, splitByShares, type BloomLevel } from '@/lib/bloom'
import { MAX_SETS, MAX_TOTAL_MCQ, createJob, jobSummary } from '@/lib/generation-jobs'
import { ExamRoom, GenerationJob } from '@/lib/models'
import { findTeacherRoom } from '@/lib/rooms'
import { readSourceFiles } from '@/lib/source-files'

/** GET /api/generation-jobs — the faculty member's AI generations that are running, ready to review, or failed. */
export const GET = handler(async () => {
  const teacher = await requireTeacher()
  const jobs = await GenerationJob.find({ teacher: teacher._id, status: { $in: ['running', 'ready', 'failed'] } })
    .select('-files -result -parts.questions').sort({ createdAt: -1 }).limit(50).lean()
  const rooms = new Map((await ExamRoom.find({ _id: { $in: jobs.map(j => j.room).filter(Boolean) } }).select('title code').lean()).map(r => [String(r._id), r]))
  return NextResponse.json({ jobs: jobs.map(job => jobSummary(job, job.room ? rooms.get(String(job.room)) : null)) })
})

/**
 * POST /api/generation-jobs (multipart) — starts an AI generation. Fields: topic, description, sourceText,
 * files (PDF, .doc, .docx, .tex; repeatable), mcqCount and codingCount (per set), sets (1-20),
 * bloomMode (mixed | custom | one Bloom level) and for custom the per-level MCQ counts per set,
 * room (optional), bloomPlan (JSON) and applyToRoom, kept for when the drafts are saved.
 * The browser then drives it with POST /api/generation-jobs/:id/run, or hands it to the server.
 */
export const POST = handler(async (request: Request) => {
  const teacher = await requireTeacher()
  await rateLimit(`ai-jobs:teacher:${teacher._id}`, 30, 60 * 60)
  const form = await request.formData()
  const text = (name: string) => String(form.get(name) ?? '').trim()
  const int = (name: string, max: number) => Math.min(max, Math.max(0, Math.round(Number(text(name)) || 0)))

  const room = text('room') ? await findTeacherRoom(teacher._id, text('room')) : null
  const files = await readSourceFiles(form)
  const sets = Math.max(1, int('sets', MAX_SETS))
  const mode = text('bloomMode')
  const single = (BLOOM_LEVELS as readonly string[]).includes(mode) ? (mode as BloomLevel) : null
  const mcqPerSet = int('mcqCount', MAX_TOTAL_MCQ)
  const levels = mode === 'custom' ? BLOOM_LEVELS.map(level => int(level, MAX_TOTAL_MCQ))
    : single ? BLOOM_LEVELS.map(level => (level === single ? mcqPerSet : 0))
    : splitByShares(mcqPerSet)
  const codingPerSet = int('codingCount', 100)
  let bloomPlan: unknown = null
  try { bloomPlan = text('bloomPlan') ? JSON.parse(text('bloomPlan')) : null } catch { throw new HttpError(400, "Invalid Bloom's level plan.") }

  const topic = text('topic').slice(0, 300)
  const sourceText = text('sourceText').slice(0, 80_000)
  const description = text('description').slice(0, 3000)
  const title = (topic || files.map(f => f.name).join(', ') || sourceText || description).replace(/\s+/g, ' ').slice(0, 120)

  const job = await createJob({
    teacher: teacher._id, room: room?._id ?? null, title, topic, description, sourceText, files, levels, singleLevel: single, codingPerSet, sets,
    plan: { sets: sets > 1 ? setNames(sets) : [], mcqPerSet: levels.reduce((a, b) => a + b, 0), codingPerSet, bloomPlan, applyToRoom: text('applyToRoom') === 'true' },
  })
  return NextResponse.json({ job: jobSummary(job, room) }, { status: 201 })
})

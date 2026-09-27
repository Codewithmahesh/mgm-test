import 'server-only'
import { randomInt } from 'node:crypto'
import type { Types } from 'mongoose'
import { Attempt, ExamRoom, Question } from './models'
import { BLOOM_LEVELS, type BloomLevel } from './bloom'
import { activeSets, setPool } from './paper-rules'

type AttemptDoc = NonNullable<Awaited<ReturnType<typeof Attempt.findOne>>>
type RoomLike = {
  _id: Types.ObjectId
  questionsPerStudent: number
  codingQuestions?: number | null
  marksPerQuestion?: number | null
  codingMarks?: number | null
  paperMode?: string | null
  setCount?: number | null
  bloomPlan?: { level: BloomLevel; count?: number | null; marks?: number | null }[] | null
}

// No 0/O/1/I so codes are easy to read out in class.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const GRACE_MS = 30_000

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export async function uniqueRoomCode() {
  for (let tries = 0; tries < 20; tries++) {
    const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
    if (!(await ExamRoom.exists({ code }))) return code
  }
  throw new Error('Could not generate a unique room code.')
}

/** Re-shuffles the room's pool whenever its questions change. */
export async function refreshPool(roomId: Types.ObjectId | string) {
  const ids = (await Question.find({ room: roomId }).select('_id').lean()).map(q => q._id)
  await ExamRoom.updateOne({ _id: roomId }, { $set: { pool: shuffle(ids), dealt: 0 } })
  return ids.length
}

function takeWrapped<T>(items: T[], start: number, count: number) {
  if (!items.length || count <= 0) return []
  return Array.from({ length: Math.min(count, items.length) }, (_, i) => items[(start + i) % items.length])
}

// Bloom levels plus a bucket for questions without a level.
const LEVELS = [...BLOOM_LEVELS, ''] as const
type Level = (typeof LEVELS)[number]
type PoolQuestion = { id: string; type: string; bloom: Level; set: string; points: number | null }

/**
 * Splits `need` across buckets in proportion to their sizes (largest remainder, ties broken by
 * bucket order). Deterministic, so every student gets exactly the same count per level.
 */
export function proportionalQuotas(sizes: number[], need: number) {
  const total = sizes.reduce((a, b) => a + b, 0)
  if (!total || need <= 0) return sizes.map(() => 0)
  const target = Math.min(need, total)
  const exact = sizes.map(size => (size * target) / total)
  const quotas = exact.map(Math.floor)
  let left = target - quotas.reduce((a, b) => a + b, 0)
  const order = exact.map((value, i) => ({ i, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.i - b.i)
  for (const { i } of order) { if (left <= 0) break; if (quotas[i] < sizes[i]) { quotas[i]++; left-- } }
  return quotas
}

const bucketSizes = (questions: PoolQuestion[]) => LEVELS.map(level => questions.filter(q => q.bloom === level).length)

/**
 * Takes `quotas[i]` questions from each level, rotating through each level by `turn` so every
 * question gets used evenly. If a level is short, the gap is filled from the other levels so the
 * paper length stays the same for everyone.
 */
function pickBalanced(candidates: PoolQuestion[], quotas: number[], turn: number) {
  const buckets = LEVELS.map(level => candidates.filter(q => q.bloom === level))
  const picked = new Set<string>()
  buckets.forEach((bucket, i) => takeWrapped(bucket, turn * quotas[i], Math.min(quotas[i], bucket.length)).forEach(q => picked.add(q.id)))
  let missing = Math.min(quotas.reduce((a, b) => a + b, 0), candidates.length) - picked.size
  for (const bucket of buckets) {
    for (const q of bucket) { if (missing <= 0) break; if (!picked.has(q.id)) { picked.add(q.id); missing-- } }
  }
  return candidates.filter(q => picked.has(q.id))
}

/**
 * Builds one student's paper so every paper is equal:
 * - Bloom plan (e.g. 3 Remember @1, 4 Apply @2, 3 Analyze @3): every paper gets exactly those counts,
 *   and each question carries its level's marks. Questions beyond the plan are balanced across
 *   levels and marked at the default marks per MCQ.
 * - No plan: levels are balanced automatically in the pool's proportions (same counts for everyone).
 * - "sets" mode: students get sets A, B, C… in the order they start; the set is saved on the paper.
 * - Within a level, students get the next slice of the shuffled pool (round-robin), so questions
 *   are spread evenly and neighbours get different papers.
 * MCQs come first in random order, coding problems last.
 */
export async function dealQuestions(room: RoomLike) {
  const questions = await Question.find({ room: room._id }).select('_id type bloom setLabel points').lean()
  const known = new Set(questions.map(q => String(q._id)))

  let current = await ExamRoom.findOneAndUpdate({ _id: room._id }, { $inc: { dealt: 1 } }, { returnDocument: 'before' }).select('pool dealt').lean()
  const poolIds = (current?.pool ?? []).map(String)
  if (poolIds.length !== known.size || poolIds.some(id => !known.has(id))) {
    await refreshPool(room._id)
    current = await ExamRoom.findOneAndUpdate({ _id: room._id }, { $inc: { dealt: 1 } }, { returnDocument: 'before' }).select('pool dealt').lean()
  }
  const byId = new Map(questions.map(q => [String(q._id), q]))
  // Pool order is the shuffled order; every list below keeps it.
  const pool: PoolQuestion[] = (current?.pool ?? []).map(String).filter(id => byId.has(id)).map(id => {
    const q = byId.get(id)!
    return { id, type: q.type ?? 'mcq', bloom: (q.bloom ?? '') as Level, set: q.setLabel ?? '', points: q.points ?? null }
  })
  let turn = current?.dealt ?? 0

  let set = ''
  let candidates = pool
  const sets = activeSets(room)
  if (sets.length) {
    set = sets[turn % sets.length]
    candidates = setPool(pool, set)
    turn = Math.floor(turn / sets.length)
  }

  const objectiveAll = pool.filter(q => q.type !== 'coding')
  const objective = candidates.filter(q => q.type !== 'coding')
  const coding = candidates.filter(q => q.type === 'coding')
  const defaultMarks = room.marksPerQuestion ?? 1

  // 1. The Bloom plan: exact count per level, at that level's marks.
  const planned: { id: string; marks: number }[] = []
  for (const row of (room.bloomPlan ?? []).filter(row => (row.count ?? 0) > 0)) {
    const bucket = objective.filter(q => q.bloom === row.level)
    const count = row.count ?? 0
    takeWrapped(bucket, turn * count, Math.min(count, bucket.length)).forEach(q => planned.push({ id: q.id, marks: row.marks ?? defaultMarks }))
  }
  // 2. The rest of the paper, balanced across levels in the whole pool's proportions (so the same across sets).
  const taken = new Set(planned.map(q => q.id))
  const rest = Math.max(0, Math.min(room.questionsPerStudent, objective.length) - planned.length)
  const unplanned = pickBalanced(objective.filter(q => !taken.has(q.id)), proportionalQuotas(bucketSizes(objectiveAll.filter(q => !taken.has(q.id))), rest), turn)
    .map(q => ({ id: q.id, marks: defaultMarks }))
  // 3. Coding problems, balanced across levels, at their own marks.
  const codingNeed = Math.min(room.codingQuestions ?? 0, coding.length)
  const codingPicked = pickBalanced(coding, proportionalQuotas(bucketSizes(pool.filter(q => q.type === 'coding')), codingNeed), turn)
    .map(q => ({ id: q.id, marks: q.points ?? room.codingMarks ?? 10 }))

  const paper = [...shuffle([...planned, ...unplanned]), ...codingPicked]
  return { questions: paper.map(q => byId.get(q.id)!._id), marks: paper.map(q => q.marks), set }
}

export type CodingAnswer = { language: string; code: string }

/** Coding answers used to be plain strings; now they're { language, code }. */
export function codingAnswer(value: unknown): CodingAnswer | null {
  if (typeof value === 'string') return value.trim() ? { language: '', code: value } : null
  if (value && typeof value === 'object' && 'code' in value) {
    const answer = value as CodingAnswer
    return typeof answer.code === 'string' && answer.code.trim() ? { language: String(answer.language ?? ''), code: answer.code } : null
  }
  return null
}

export function isAnswered(value: unknown) {
  return typeof value === 'number' || codingAnswer(value) !== null
}

/**
 * Scores an attempt. MCQ/TF are auto-graded (with optional negative marking);
 * coding problems use the marks the teacher entered, and count as pending until graded.
 */
export async function gradeAttempt(attempt: AttemptDoc, codingMarksDefault?: number) {
  const questions = await Question.find({ _id: { $in: attempt.questions } }).select('type correctIndex points').lean()
  const byId = new Map(questions.map(q => [String(q._id), q]))
  const marksByQuestion = new Map(attempt.codingMarks.map(mark => [String(mark.question), mark.marks ?? 0]))
  const defaultPoints = codingMarksDefault ?? 10

  // Each question's marks were fixed when the paper was dealt (Bloom level marks); older papers use one value.
  const markAt = (index: number) => attempt.questionMarks?.[index] ?? attempt.marksPerQuestion
  let correct = 0
  let wrong = 0
  let mcqScore = 0
  let codingScore = 0
  let codingPending = 0
  let maxScore = 0
  attempt.questions.forEach((id, index) => {
    const question = byId.get(String(id))
    if (!question) return
    const answer = attempt.answers[index]
    if (question.type === 'coding') {
      maxScore += question.points ?? defaultPoints
      if (marksByQuestion.has(String(id))) codingScore += marksByQuestion.get(String(id))!
      else if (codingAnswer(answer)) codingPending++
    } else {
      maxScore += markAt(index)
      if (typeof answer !== 'number') return
      if (answer === question.correctIndex) { correct++; mcqScore += markAt(index) }
      else wrong++
    }
  })
  attempt.correctCount = correct
  attempt.wrongCount = wrong
  attempt.mcqScore = round(mcqScore - wrong * (attempt.negativeMarks ?? 0))
  attempt.codingScore = round(codingScore)
  attempt.codingPending = codingPending
  attempt.score = round(attempt.mcqScore + attempt.codingScore)
  attempt.maxScore = round(maxScore)
}

const round = (value: number) => Math.round(value * 100) / 100

export type SubmitReason = 'time' | 'violations' | 'faculty' | 'room_closed'

export async function submitAttempt(attempt: AttemptDoc, { auto = false, reason }: { auto?: boolean; reason?: SubmitReason } = {}) {
  if (attempt.status === 'submitted') return attempt
  const room = await ExamRoom.findById(attempt.room).select('codingMarks').lean()
  await gradeAttempt(attempt, room?.codingMarks)
  attempt.status = 'submitted'
  attempt.submittedAt = new Date()
  attempt.autoSubmitted = auto
  attempt.autoSubmitReason = auto ? reason ?? 'time' : ''
  await attempt.save()
  return attempt
}

/** Submits the attempt automatically if its time ran out (plus a short grace period for network delay). */
export async function submitIfExpired(attempt: AttemptDoc) {
  if (attempt.status === 'in_progress' && Date.now() > attempt.endsAt.getTime() + GRACE_MS) await submitAttempt(attempt, { auto: true, reason: 'time' })
  return attempt
}

export function isAcceptingAnswers(attempt: AttemptDoc) {
  return attempt.status === 'in_progress' && Date.now() <= attempt.endsAt.getTime() + GRACE_MS
}

/** Whether a student may see their score yet, per the room's result setting. */
export function resultsVisible(room: { showResults?: string | null; status?: string | null }, attempt: { status: string }) {
  if (attempt.status !== 'submitted') return false
  if (room.showResults === 'after_submit') return true
  if (room.showResults === 'never') return false
  return room.status === 'closed'
}

import 'server-only'
import { randomInt } from 'node:crypto'
import type { Types } from 'mongoose'
import { Attempt, ExamRoom, Question } from './models'
import { fixedMix, setLabels } from './paper-rules'

type AttemptDoc = NonNullable<Awaited<ReturnType<typeof Attempt.findOne>>>
type RoomLike = {
  _id: Types.ObjectId
  questionsPerStudent: number
  codingQuestions?: number | null
  paperMode?: string | null
  difficultyMix?: { easy?: number | null; medium?: number | null; hard?: number | null } | null
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

// Difficulty buckets; questions without a difficulty form their own bucket.
const LEVELS = ['easy', 'medium', 'hard', ''] as const
type Level = (typeof LEVELS)[number]
type PoolQuestion = { id: string; type: string; difficulty: Level; set: string }

/**
 * Splits `need` across buckets in proportion to their sizes (largest remainder, ties broken by
 * bucket order). Deterministic, so every student gets exactly the same easy/medium/hard counts.
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

/**
 * Takes `quotas[i]` questions from each difficulty bucket, rotating through each bucket by `turn`
 * so every question gets used evenly. If a bucket is short, the gap is filled from the other
 * buckets (in order), so the paper length stays the same for everyone.
 */
function pickBalanced(candidates: PoolQuestion[], quotas: number[], turn: number) {
  const buckets = LEVELS.map(level => candidates.filter(q => q.difficulty === level))
  const picked = new Set<string>()
  buckets.forEach((bucket, i) => takeWrapped(bucket, turn * quotas[i], Math.min(quotas[i], bucket.length)).forEach(q => picked.add(q.id)))
  let missing = quotas.reduce((a, b) => a + b, 0) - picked.size
  for (const bucket of buckets) {
    for (const q of bucket) { if (missing <= 0) break; if (!picked.has(q.id)) { picked.add(q.id); missing-- } }
  }
  return candidates.filter(q => picked.has(q.id)).map(q => q.id)
}

const bucketSizes = (questions: PoolQuestion[]) => LEVELS.map(level => questions.filter(q => q.difficulty === level).length)

/**
 * Picks this student's questions so every paper is equally hard:
 * - The difficulty mix (e.g. 6 easy, 8 medium, 6 hard) is fixed per room, either set by the faculty
 *   or worked out once from the whole pool, and is identical for every student.
 * - "random" mode draws from the whole pool; "sets" mode gives students sets A, B, C… in rotation.
 * - Within a difficulty, students get the next slice of the shuffled pool (round-robin), so
 *   questions are spread evenly and neighbours get different papers.
 * MCQs come first in random order, coding problems last.
 */
export async function dealQuestions(room: RoomLike) {
  const questions = await Question.find({ room: room._id }).select('_id type difficulty set').lean()
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
    return { id, type: q.type ?? 'mcq', difficulty: ((q.difficulty ?? '') as Level), set: q.set ?? '' }
  })
  let turn = current?.dealt ?? 0

  // Sets mode: this student's candidates are one set plus the common (unlabelled) questions.
  let candidates = pool
  const sets = room.paperMode === 'sets' ? setLabels(pool) : []
  if (sets.length) {
    const mySet = sets[turn % sets.length]
    candidates = pool.filter(q => q.set === mySet || !q.set)
    turn = Math.floor(turn / sets.length)
  }

  const objectiveAll = pool.filter(q => q.type !== 'coding')
  const codingAll = pool.filter(q => q.type === 'coding')
  const objective = candidates.filter(q => q.type !== 'coding')
  const coding = candidates.filter(q => q.type === 'coding')

  // The mix comes from the faculty's fixed counts, or from the whole room pool so it is the same
  // across sets; never from this student's candidates alone.
  const mix = fixedMix(room)
  const fixed = mix ? [mix.easy, mix.medium, mix.hard, 0] : null
  const objectiveNeed = Math.min(fixed ? fixed.reduce((a, b) => a + b, 0) : room.questionsPerStudent, objective.length)
  const objectiveQuotas = fixed ?? proportionalQuotas(bucketSizes(objectiveAll), objectiveNeed)
  const codingNeed = Math.min(room.codingQuestions ?? 0, coding.length)
  const codingQuotas = proportionalQuotas(bucketSizes(codingAll), codingNeed)

  const picked = [
    ...shuffle(pickBalanced(objective, scaleTo(objectiveQuotas, objectiveNeed), turn)),
    ...pickBalanced(coding, scaleTo(codingQuotas, codingNeed), turn),
  ]
  return picked.map(id => byId.get(id)!._id)
}

/** Trims quotas down to `need` (when the candidates are fewer than asked for), keeping the proportions. */
function scaleTo(quotas: number[], need: number) {
  const total = quotas.reduce((a, b) => a + b, 0)
  return total <= need ? quotas : proportionalQuotas(quotas, need)
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

  let correct = 0
  let wrong = 0
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
      maxScore += attempt.marksPerQuestion
      if (typeof answer !== 'number') return
      if (answer === question.correctIndex) correct++
      else wrong++
    }
  })
  attempt.correctCount = correct
  attempt.wrongCount = wrong
  attempt.mcqScore = round(correct * attempt.marksPerQuestion - wrong * (attempt.negativeMarks ?? 0))
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

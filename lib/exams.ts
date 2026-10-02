import 'server-only'
import { randomInt } from 'node:crypto'
import type { Types } from 'mongoose'
import { Attempt, ExamRoom, Question } from './models'
import { BLOOM_LEVELS, type BloomLevel } from './bloom'
import { activeSets, paperKind, setPool } from './paper-rules'
import { evaluateCode } from './code-runs'
import { emailAfterSubmit } from './result-email'

type AttemptDoc = NonNullable<Awaited<ReturnType<typeof Attempt.findOne>>>
type RoomLike = {
  _id: Types.ObjectId
  questionsPerStudent: number
  tfQuestions?: number | null
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
 * - True/False questions (on rooms that count them separately) are balanced across levels the same way,
 *   at the default marks, and mixed in with the MCQs.
 * MCQs and True/False come first in random order, coding problems last.
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

  // On older rooms True/False questions count as MCQs (see separateTf).
  const objectiveAll = pool.filter(q => paperKind(room, q.type) === 'mcq')
  const objective = candidates.filter(q => paperKind(room, q.type) === 'mcq')
  const trueFalse = candidates.filter(q => paperKind(room, q.type) === 'tf')
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
  // 3. True/False questions, balanced across levels, at the default marks.
  const tfNeed = Math.min(room.tfQuestions ?? 0, trueFalse.length)
  const tfPicked = pickBalanced(trueFalse, proportionalQuotas(bucketSizes(pool.filter(q => paperKind(room, q.type) === 'tf')), tfNeed), turn)
    .map(q => ({ id: q.id, marks: defaultMarks }))
  // 4. Coding problems, balanced across levels, at their own marks.
  const codingNeed = Math.min(room.codingQuestions ?? 0, coding.length)
  const codingPicked = pickBalanced(coding, proportionalQuotas(bucketSizes(pool.filter(q => q.type === 'coding')), codingNeed), turn)
    .map(q => ({ id: q.id, marks: q.points ?? room.codingMarks ?? 10 }))

  const paper = [...shuffle([...planned, ...unplanned, ...tfPicked]), ...codingPicked]
  return { questions: paper.map(q => byId.get(q.id)!._id), marks: paper.map(q => q.marks), set }
}

export type CodingAnswer = {
  language: string
  code: string
  passedCases?: number
  totalCases?: number
  marks?: number
}

/** Coding answers can be plain strings or structured objects with optional evaluation results. */
export function codingAnswer(value: unknown): CodingAnswer | null {
  if (typeof value === 'string') return value.trim() ? { language: '', code: value } : null
  if (value && typeof value === 'object' && 'code' in value) {
    const answer = value as Record<string, unknown>
    if (typeof answer.code === 'string' && answer.code.trim()) {
      return {
        language: String(answer.language ?? ''),
        code: answer.code,
        passedCases: typeof answer.passedCases === 'number' ? answer.passedCases : undefined,
        totalCases: typeof answer.totalCases === 'number' ? answer.totalCases : undefined,
        marks: typeof answer.marks === 'number' ? answer.marks : undefined,
      }
    }
  }
  return null
}

export function isAnswered(value: unknown) {
  return typeof value === 'number' || codingAnswer(value) !== null
}

/**
 * Scores an attempt. MCQ/TF are auto-graded (with optional negative marking);
 * coding problems are automatically graded based on passed test cases (100% for all passed,
 * proportional for partial), with teacher manual overrides taking precedence.
 */
export async function gradeAttempt(attempt: AttemptDoc, codingMarksDefault?: number) {
  const questions = await Question.find({ _id: { $in: attempt.questions } }).select('type correctIndex points samples hiddenTests').lean()
  const byId = new Map(questions.map(q => [String(q._id), q]))
  const marksByQuestion = new Map(attempt.codingMarks.map(mark => [String(mark.question), mark.marks ?? 0]))
  const defaultPoints = codingMarksDefault ?? 10

  // Each question's marks were fixed when the paper was dealt (Bloom level marks); older papers use one value.
  const markAt = (index: number) => attempt.questionMarks?.[index] ?? attempt.marksPerQuestion

  // Code the student never ran during the exam is run against the samples here. Start every such run at
  // once instead of one question after another, so submitting doesn't take the sum of all of them.
  // Graded on the samples the student saw plus the hidden tests, samples first.
  type Test = { input?: string | null; output?: string | null }
  const gradingCases = (q: { samples?: Test[]; hiddenTests?: Test[] }) => [...(q.samples ?? []), ...(q.hiddenTests ?? [])].map(t => ({ input: t.input ?? '', expectedOutput: t.output ?? '' }))
  const evaluations = new Map<number, ReturnType<typeof evaluateCode>>()
  attempt.questions.forEach((id, index) => {
    const question = byId.get(String(id))
    if (question?.type !== 'coding' || marksByQuestion.has(String(id)) || !gradingCases(question).length) return
    const ca = codingAnswer(attempt.answers[index])
    if (!ca?.code?.trim()) return
    const run = evaluateCode(ca.language || 'cpp', ca.code, gradingCases(question))
    run.catch(() => {}) // awaited (and its error handled) in the loop below
    evaluations.set(index, run)
  })
  let correct = 0
  let wrong = 0
  let mcqScore = 0
  let codingScore = 0
  let codingPending = 0
  let maxScore = 0

  for (let index = 0; index < attempt.questions.length; index++) {
    const id = attempt.questions[index]
    const question = byId.get(String(id))
    if (!question) continue
    const answer = attempt.answers[index]
    if (question.type === 'coding') {
      const qPoints = question.points ?? defaultPoints
      maxScore += qPoints
      if (marksByQuestion.has(String(id))) {
        // Teacher manual grading takes precedence
        codingScore += marksByQuestion.get(String(id))!
      } else {
        const ca = codingAnswer(answer)
        if (ca && ca.code && ca.code.trim()) {
          // Always graded here, by running the code on the server. Results the browser reports from the
          // student's own test runs are only for display: they could be edited, so they never count.
          if (gradingCases(question).length > 0) {
            try {
              const evalRes = await (evaluations.get(index) ?? evaluateCode(ca.language || 'cpp', ca.code, gradingCases(question)))
              const totalCount = evalRes.testResults?.length ?? 0
              const passedCount = evalRes.testResults?.filter(r => r.passed).length ?? 0
              const allPassed = passedCount === totalCount && totalCount > 0
              const autoMarks = allPassed ? qPoints : (totalCount > 0 ? round((passedCount / totalCount) * qPoints) : 0)
              codingScore += autoMarks

              const existing = attempt.codingMarks.find(m => String(m.question) === String(id))
              const sampleCount = question.samples?.length ?? 0
              const hiddenCount = totalCount - sampleCount
              const passedSamples = evalRes.testResults?.slice(0, sampleCount).filter(r => r.passed).length ?? 0
              const split = hiddenCount > 0 ? ` · samples ${passedSamples}/${sampleCount}, hidden ${passedCount - passedSamples}/${hiddenCount}` : ''
              const feedbackText = totalCount > 0
                ? (allPassed ? `All ${totalCount} test cases passed (100%)${split}` : `${passedCount}/${totalCount} test cases passed (${Math.round((passedCount / totalCount) * 100)}%)${split}`)
                : 'Evaluated'
              if (existing) {
                existing.marks = autoMarks
                if (!existing.feedback) existing.feedback = feedbackText
              } else {
                attempt.codingMarks.push({ question: id, marks: autoMarks, feedback: feedbackText })
              }
              if (typeof attempt.answers[index] === 'object' && attempt.answers[index] !== null) {
                attempt.answers[index] = {
                  ...(attempt.answers[index] as object),
                  passedCases: passedCount,
                  totalCases: totalCount,
                  marks: autoMarks,
                }
                attempt.markModified('answers')
              }
            } catch (err) {
              console.error('Server auto-grading error for question', id, err)
              codingPending++
            }
          } else {
            codingPending++
          }
        }
      }
    } else {
      maxScore += markAt(index)
      if (typeof answer !== 'number') continue
      if (answer === question.correctIndex) { correct++; mcqScore += markAt(index) }
      else wrong++
    }
  }
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
  // Email the student: score and analysis, or "answers received".
  emailAfterSubmit(attempt._id)
  return attempt
}

/**
 * Submits the attempt automatically if its time ran out (plus a short grace period for network delay),
 * or if the faculty member has ended the exam: once a room is closed nobody keeps writing, whatever
 * their personal end time says.
 */
export async function submitIfExpired(attempt: AttemptDoc) {
  if (attempt.status !== 'in_progress') return attempt
  if (Date.now() > attempt.endsAt.getTime() + GRACE_MS) await submitAttempt(attempt, { auto: true, reason: 'time' })
  else if ((await ExamRoom.findById(attempt.room).select('status').lean())?.status === 'closed') await submitAttempt(attempt, { auto: true, reason: 'room_closed' })
  return attempt
}

/** Runs `task` over `items`, at most `limit` at a time. */
async function eachLimit<T>(items: T[], limit: number, task: (item: T) => Promise<unknown>) {
  let next = 0
  const worker = async () => { while (next < items.length) await task(items[next++]) }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** Grading can run code, so several attempts are submitted side by side rather than one after another. */
const SUBMIT_PARALLEL = 4

/** Submits many attempts (e.g. when the faculty member ends the exam), a few at a time. */
export async function submitAttempts(attempts: AttemptDoc[], options: { auto?: boolean; reason?: SubmitReason } = {}) {
  await eachLimit(attempts, SUBMIT_PARALLEL, attempt => submitAttempt(attempt, options))
}

/** submitIfExpired for a whole list: each room's status is looked up once and expired attempts are submitted a few at a time. */
export async function submitAllIfExpired(attempts: AttemptDoc[]) {
  const due = attempts.filter(attempt => attempt.status === 'in_progress')
  if (!due.length) return attempts
  const closed = new Set((await ExamRoom.find({ _id: { $in: [...new Set(due.map(a => String(a.room)))] }, status: 'closed' }).select('_id').lean()).map(room => String(room._id)))
  const now = Date.now()
  await eachLimit(due, SUBMIT_PARALLEL, async attempt => {
    if (now > attempt.endsAt.getTime() + GRACE_MS) await submitAttempt(attempt, { auto: true, reason: 'time' })
    else if (closed.has(String(attempt.room))) await submitAttempt(attempt, { auto: true, reason: 'room_closed' })
  })
  return attempts
}

export function isAcceptingAnswers(attempt: AttemptDoc) {
  return attempt.status === 'in_progress' && Date.now() <= attempt.endsAt.getTime() + GRACE_MS
}

export { resultsVisible } from './visibility'

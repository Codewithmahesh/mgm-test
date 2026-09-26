import 'server-only'
import { randomInt } from 'node:crypto'
import type { Types } from 'mongoose'
import { Attempt, ExamRoom, Question } from './models'

type AttemptDoc = NonNullable<Awaited<ReturnType<typeof Attempt.findOne>>>
type RoomLike = { _id: Types.ObjectId; questionsPerStudent: number; codingQuestions?: number | null }

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

/**
 * Picks this student's questions. Each new student gets the next slice of the shuffled pool
 * (round-robin), so questions are spread evenly and neighbours get different papers.
 * MCQs come first in random order, coding problems last.
 */
export async function dealQuestions(room: RoomLike) {
  const questions = await Question.find({ room: room._id }).select('_id type').lean()
  const typeById = new Map(questions.map(q => [String(q._id), q.type]))

  let current = await ExamRoom.findOneAndUpdate({ _id: room._id }, { $inc: { dealt: 1 } }, { returnDocument: 'before' }).select('pool dealt').lean()
  const poolIds = (current?.pool ?? []).map(String)
  if (poolIds.length !== typeById.size || poolIds.some(id => !typeById.has(id))) {
    await refreshPool(room._id)
    current = await ExamRoom.findOneAndUpdate({ _id: room._id }, { $inc: { dealt: 1 } }, { returnDocument: 'before' }).select('pool dealt').lean()
  }
  const pool = (current?.pool ?? []).map(String)
  const turn = current?.dealt ?? 0

  const coding = pool.filter(id => typeById.get(id) === 'coding')
  const objective = pool.filter(id => typeById.get(id) !== 'coding')
  const codingCount = Math.min(room.codingQuestions ?? 0, coding.length)
  const objectiveCount = Math.min(room.questionsPerStudent, objective.length)

  const picked = [
    ...shuffle(takeWrapped(objective, turn * objectiveCount, objectiveCount)),
    ...takeWrapped(coding, turn * codingCount, codingCount),
  ]
  const byId = new Map(questions.map(q => [String(q._id), q._id]))
  return picked.map(id => byId.get(id)!)
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

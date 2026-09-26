import 'server-only'
import type { Types } from 'mongoose'
import { HttpError } from './auth'
import { INTEGRITY_EVENTS, INTEGRITY_EVENT_TYPES } from './integrity'
import { Attempt, ExamRoom, JoinRequest, PAPER_MODES, Question, RESULT_VISIBILITY, isObjectId } from './models'

// Sum of violation-type flags on an attempt, as a MongoDB expression.
const violationsExpr = { $add: [...INTEGRITY_EVENT_TYPES.filter(t => INTEGRITY_EVENTS[t].violation).map(t => ({ $ifNull: [`$flags.${t}`, 0] })), 0] }

type RoomLean = {
  _id: Types.ObjectId
  title: string
  description?: string | null
  instructions?: string | null
  code: string
  questionsPerStudent: number
  codingQuestions?: number | null
  marksPerQuestion: number
  negativeMarks?: number | null
  codingMarks?: number | null
  durationMinutes: number
  startsAt?: Date | null
  status: string
  showResults?: string | null
  allowedClassrooms?: Types.ObjectId[] | null
  requireFullscreen?: boolean | null
  blockCopyPaste?: boolean | null
  maxViolations?: number | null
  requireApproval?: boolean | null
  paperMode?: string | null
  difficultyMix?: { easy?: number | null; medium?: number | null; hard?: number | null } | null
  createdAt?: Date
  updatedAt?: Date
}

/** Adds question and attempt counts to rooms for the dashboard and room lists. */
export async function withRoomStats(rooms: RoomLean[]) {
  const ids = rooms.map(room => room._id)
  const [questionCounts, attemptCounts, waitingCounts] = await Promise.all([
    Question.aggregate<{ _id: Types.ObjectId; total: number; coding: number }>([
      { $match: { room: { $in: ids } } },
      { $group: { _id: '$room', total: { $sum: 1 }, coding: { $sum: { $cond: [{ $eq: ['$type', 'coding'] }, 1, 0] } } } },
    ]),
    Attempt.aggregate<{ _id: Types.ObjectId; joined: number; submitted: number; avgPercent: number | null; pending: number; flagged: number }>([
      { $match: { room: { $in: ids } } },
      {
        $group: {
          _id: '$room',
          joined: { $sum: 1 },
          submitted: { $sum: { $cond: [{ $eq: ['$status', 'submitted'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $gt: ['$codingPending', 0] }, 1, 0] } },
          flagged: { $sum: { $cond: [{ $or: [{ $gt: [violationsExpr, 0] }, { $gt: [{ $ifNull: ['$tabSwitches', 0] }, 0] }] }, 1, 0] } },
          avgPercent: { $avg: { $cond: [{ $and: [{ $eq: ['$status', 'submitted'] }, { $gt: ['$maxScore', 0] }] }, { $divide: ['$score', '$maxScore'] }, null] } },
        },
      },
    ]),
    JoinRequest.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { room: { $in: ids }, status: 'pending' } },
      { $group: { _id: '$room', count: { $sum: 1 } } },
    ]),
  ])
  const waitingBy = new Map(waitingCounts.map(c => [String(c._id), c.count]))
  const questionsBy = new Map(questionCounts.map(c => [String(c._id), c]))
  const attemptsBy = new Map(attemptCounts.map(c => [String(c._id), c]))
  return rooms.map(room => ({ ...serializeRoom(room, questionsBy.get(String(room._id)), attemptsBy.get(String(room._id))), waiting: waitingBy.get(String(room._id)) ?? 0 }))
}

export function serializeRoom(
  room: RoomLean,
  questions?: { total: number; coding: number },
  attempts?: { joined: number; submitted: number; avgPercent: number | null; pending?: number; flagged?: number },
) {
  return {
    id: String(room._id),
    title: room.title,
    description: room.description ?? '',
    instructions: room.instructions ?? '',
    code: room.code,
    questionsPerStudent: room.questionsPerStudent,
    codingQuestions: room.codingQuestions ?? 0,
    marksPerQuestion: room.marksPerQuestion,
    negativeMarks: room.negativeMarks ?? 0,
    codingMarks: room.codingMarks ?? 10,
    durationMinutes: room.durationMinutes,
    startsAt: room.startsAt ?? null,
    status: room.status,
    showResults: room.showResults ?? 'after_end',
    allowedClassrooms: (room.allowedClassrooms ?? []).map(String),
    requireFullscreen: room.requireFullscreen ?? true,
    blockCopyPaste: room.blockCopyPaste ?? true,
    maxViolations: room.maxViolations ?? 0,
    requireApproval: room.requireApproval ?? true,
    paperMode: (room.paperMode === 'sets' ? 'sets' : 'random') as 'random' | 'sets',
    difficultyMix: room.difficultyMix && (room.difficultyMix.easy || room.difficultyMix.medium || room.difficultyMix.hard)
      ? { easy: room.difficultyMix.easy ?? 0, medium: room.difficultyMix.medium ?? 0, hard: room.difficultyMix.hard ?? 0 }
      : null,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    poolSize: questions?.total ?? 0,
    mcqPoolSize: (questions?.total ?? 0) - (questions?.coding ?? 0),
    codingPoolSize: questions?.coding ?? 0,
    joined: attempts?.joined ?? 0,
    submitted: attempts?.submitted ?? 0,
    pendingReview: attempts?.pending ?? 0,
    flagged: attempts?.flagged ?? 0,
    averagePercent: attempts?.avgPercent == null ? null : Math.round(attempts.avgPercent * 100),
  }
}

export async function findTeacherRoom(teacherId: Types.ObjectId, id: string) {
  if (!isObjectId(id)) throw new HttpError(404, 'Exam room not found.')
  const room = await ExamRoom.findOne({ _id: id, teacher: teacherId })
  if (!room) throw new HttpError(404, 'Exam room not found.')
  return room
}

/** Validates room settings from a request body; `partial` allows omitted fields (for PATCH). */
export function roomSettings(body: Record<string, unknown>, partial = false) {
  const settings: Record<string, unknown> = {}
  const has = (key: string) => key in body && body[key] !== undefined
  const number = (key: string, label: string, min: number, max: number, integer = true) => {
    if (!has(key)) {
      if (!partial) throw new HttpError(400, `${label} is required.`)
      return
    }
    const value = Number(body[key])
    if (!Number.isFinite(value) || value < min || value > max) throw new HttpError(400, `${label} must be between ${min} and ${max}.`)
    settings[key] = integer ? Math.round(value) : Math.round(value * 100) / 100
  }
  const text = (key: string, max: number) => { if (has(key)) settings[key] = String(body[key] ?? '').trim().slice(0, max) }

  if (has('title') || !partial) {
    const title = String(body.title ?? '').trim()
    if (!title) throw new HttpError(400, 'Give the exam a name.')
    settings.title = title.slice(0, 120)
  }
  text('description', 1000)
  text('instructions', 5000)
  number('durationMinutes', 'Duration', 1, 600)
  number('questionsPerStudent', 'MCQs per student', 0, 500)
  if (has('codingQuestions') || !partial) settings.codingQuestions = 0
  if (has('codingQuestions')) number('codingQuestions', 'Coding problems per student', 0, 20)
  if (has('marksPerQuestion') || !partial) { settings.marksPerQuestion = 1; if (has('marksPerQuestion')) number('marksPerQuestion', 'Marks per MCQ', 0, 100, false) }
  if (has('negativeMarks')) number('negativeMarks', 'Negative marks', 0, 100, false)
  if (has('codingMarks')) number('codingMarks', 'Marks per coding problem', 0, 1000, false)
  if (has('startsAt')) {
    if (!body.startsAt) settings.startsAt = null
    else {
      const date = new Date(String(body.startsAt))
      if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Start time is not a valid date.')
      settings.startsAt = date
    }
  }
  if (has('status')) {
    if (!['draft', 'open', 'closed'].includes(String(body.status))) throw new HttpError(400, 'Status must be draft, open or closed.')
    settings.status = body.status
  }
  if (has('showResults')) {
    if (!(RESULT_VISIBILITY as readonly string[]).includes(String(body.showResults))) throw new HttpError(400, 'Invalid result visibility.')
    settings.showResults = body.showResults
  }
  if (has('requireFullscreen')) settings.requireFullscreen = Boolean(body.requireFullscreen)
  if (has('blockCopyPaste')) settings.blockCopyPaste = Boolean(body.blockCopyPaste)
  if (has('requireApproval')) settings.requireApproval = Boolean(body.requireApproval)
  if (has('maxViolations')) number('maxViolations', 'Violation limit', 0, 100)
  if (has('paperMode')) {
    if (!(PAPER_MODES as readonly string[]).includes(String(body.paperMode))) throw new HttpError(400, 'Paper mode must be random or sets.')
    settings.paperMode = body.paperMode
  }
  if (has('difficultyMix')) {
    const mix = body.difficultyMix as Record<string, unknown> | null
    if (!mix) settings.difficultyMix = null
    else {
      const counts = { easy: 0, medium: 0, hard: 0 }
      for (const level of ['easy', 'medium', 'hard'] as const) {
        const value = Number(mix[level] ?? 0)
        if (!Number.isInteger(value) || value < 0 || value > 500) throw new HttpError(400, `${level[0].toUpperCase() + level.slice(1)} questions must be a whole number between 0 and 500.`)
        counts[level] = value
      }
      const total = counts.easy + counts.medium + counts.hard
      settings.difficultyMix = total ? counts : null
      // A fixed mix defines the paper's MCQ count.
      if (total) settings.questionsPerStudent = total
    }
  }
  if (has('allowedClassrooms')) {
    const list = Array.isArray(body.allowedClassrooms) ? body.allowedClassrooms : []
    settings.allowedClassrooms = list.filter(isObjectId)
  }
  return settings
}

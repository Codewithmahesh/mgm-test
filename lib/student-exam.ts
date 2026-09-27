import 'server-only'
import { paperMarks } from './bloom'
import { cleanPlan } from './rooms'
import { HttpError, type requireStudent } from './auth'
import { Attempt, ExamRoom, JoinRequest, LANGUAGES, Question, Teacher, classLabel, isObjectId } from './models'

type StudentDoc = Awaited<ReturnType<typeof requireStudent>>

export function normalizeCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export async function findRoomByCode(code: string) {
  const room = await ExamRoom.findOne({ code: normalizeCode(code) }).select('-pool').lean()
  if (!room) throw new HttpError(404, 'No exam room has that code. Check it with your faculty.')
  return room
}

type RoomLean = Awaited<ReturnType<typeof findRoomByCode>>

/** Why this student can't start the room right now, or null if they can. */
export function startBlocker(room: RoomLean, student: StudentDoc): string | null {
  if (room.status === 'draft') return "This exam hasn't been opened yet. Wait for your faculty to start it."
  if (room.status === 'closed') return 'This exam has ended.'
  if (room.startsAt && room.startsAt.getTime() > Date.now()) return `This exam starts at ${room.startsAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.`
  if (room.allowedClassrooms?.length) {
    const classroomId = student.classroom && typeof student.classroom === 'object' ? String((student.classroom as { _id: unknown })._id) : null
    if (!classroomId || !room.allowedClassrooms.some(id => String(id) === classroomId)) return 'This exam is not open to your class.'
  }
  return null
}

export const requiresApproval = (room: { requireApproval?: boolean | null }) => room.requireApproval ?? true

/** The student's join request for a waiting-room exam, if any. */
export function findJoinRequest(room: RoomLean, student: StudentDoc) {
  return JoinRequest.findOne({ room: room._id, studentEmail: student.officialEmail }).lean()
}

/** Creates (or re-opens after a decline) the student's request to be admitted. */
export async function requestToJoin(room: RoomLean, student: StudentDoc) {
  const classroom = student.classroom && typeof student.classroom === 'object' ? (student.classroom as { class?: string; branch?: string; division?: string }) : null
  // Asking again while already waiting (or admitted) keeps the student's place in the queue.
  const existing = await findJoinRequest(room, student)
  if (existing && existing.status !== 'rejected') return existing
  return JoinRequest.findOneAndUpdate(
    { room: room._id, studentEmail: student.officialEmail, status: { $ne: 'admitted' } },
    { $set: { status: 'pending', requestedAt: new Date(), decidedAt: null, student: student._id, studentName: student.name, rollNumber: student.rollNumber ?? '', className: classLabel(classroom) } },
    { upsert: true, returnDocument: 'after' },
  ).lean().catch(async error => {
    // Already admitted (the filter skipped it and the upsert hit the unique index): return that one.
    if ((error as { code?: number }).code === 11000) return findJoinRequest(room, student)
    throw error
  })
}

export async function lobbyView(room: RoomLean, student: StudentDoc) {
  const [teacher, attempt, request] = await Promise.all([
    Teacher.findById(room.teacher).select('name department').lean(),
    Attempt.findOne({ room: room._id, studentEmail: student.officialEmail }).select('status endsAt').lean(),
    requiresApproval(room) ? findJoinRequest(room, student) : null,
  ])
  return {
    room: {
      code: room.code,
      title: room.title,
      description: room.description ?? '',
      instructions: room.instructions ?? '',
      teacher: teacher?.name ?? '',
      department: teacher?.department ?? '',
      durationMinutes: room.durationMinutes,
      mcqCount: room.questionsPerStudent,
      codingCount: room.codingQuestions ?? 0,
      marksPerQuestion: room.marksPerQuestion,
      negativeMarks: room.negativeMarks ?? 0,
      codingMarks: room.codingMarks ?? 10,
      mcqMarks: paperMarks({ ...room, bloomPlan: cleanPlan(room.bloomPlan) }).mcq,
      totalMarks: paperMarks({ ...room, bloomPlan: cleanPlan(room.bloomPlan) }).total,
      marksVary: cleanPlan(room.bloomPlan).some(row => row.marks !== room.marksPerQuestion),
      startsAt: room.startsAt ?? null,
      status: room.status,
      requireFullscreen: room.requireFullscreen ?? true,
      blockCopyPaste: room.blockCopyPaste ?? true,
      maxViolations: room.maxViolations ?? 0,
      requireApproval: requiresApproval(room),
    },
    request: request ? { status: request.status, requestedAt: request.requestedAt, decidedAt: request.decidedAt ?? null } : null,
    attempt: attempt ? { id: String(attempt._id), status: attempt.status, endsAt: attempt.endsAt } : null,
    blocker: attempt ? null : startBlocker(room, student),
  }
}

/** Loads one of the signed-in student's own attempts. */
export async function findOwnAttempt(student: StudentDoc, id: string) {
  if (!isObjectId(id)) throw new HttpError(404, 'Exam attempt not found.')
  const attempt = await Attempt.findOne({ _id: id, $or: [{ student: student._id }, { studentEmail: student.officialEmail }] })
  if (!attempt) throw new HttpError(404, 'Exam attempt not found.')
  return attempt
}

/** Validates and stores answers keyed by question number. `strict` rejects invalid ones instead of skipping them. */
export async function applyAnswers(attempt: Awaited<ReturnType<typeof findOwnAttempt>>, answers: Record<string, unknown>, strict = true) {
  const questions = new Map((await Question.find({ _id: { $in: attempt.questions } }).select('type options').lean()).map(q => [String(q._id), q]))
  for (const [key, value] of Object.entries(answers)) {
    const index = Number(key) - 1
    if (!Number.isInteger(index) || index < 0 || index >= attempt.questions.length) continue
    const question = questions.get(String(attempt.questions[index]))
    if (!question) continue
    if (value === null) { attempt.answers[index] = null; continue }
    if (question.type === 'coding') {
      const answer = value as { language?: unknown; code?: unknown }
      const language = String(answer?.language ?? '')
      if (typeof answer?.code === 'string' && (LANGUAGES as readonly string[]).includes(language)) {
        attempt.answers[index] = { language, code: answer.code.slice(0, 50_000) }
        continue
      }
    } else if (Number.isInteger(value) && (value as number) >= 0 && (value as number) < question.options.length) {
      attempt.answers[index] = value
      continue
    }
    if (strict) throw new HttpError(400, `Invalid answer for question ${index + 1}.`)
  }
  attempt.markModified('answers')
}

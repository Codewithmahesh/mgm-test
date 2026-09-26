import 'server-only'
import { HttpError, type requireStudent } from './auth'
import { Attempt, ExamRoom, LANGUAGES, Question, Teacher, isObjectId } from './models'

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

export async function lobbyView(room: RoomLean, student: StudentDoc) {
  const [teacher, attempt] = await Promise.all([
    Teacher.findById(room.teacher).select('name department').lean(),
    Attempt.findOne({ room: room._id, studentEmail: student.officialEmail }).select('status endsAt').lean(),
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
      startsAt: room.startsAt ?? null,
      status: room.status,
      requireFullscreen: room.requireFullscreen ?? true,
      blockCopyPaste: room.blockCopyPaste ?? true,
      maxViolations: room.maxViolations ?? 0,
    },
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

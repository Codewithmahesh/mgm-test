import 'server-only'
import type { Types } from 'mongoose'
import { connectDb } from './db'
import { formatTime, formatWhen, renderEmail, type EmailContent } from './email-template'
import { sendMail } from './mail'
import { ExamRoom, Teacher } from './models'
import { openProblem } from './rooms'

// Scheduled exams: an email when a start time is set, a reminder 20 minutes before, and (when the
// faculty member turned it on) opening the room by itself at the start time.
// runScheduleTick() does the timed work; it runs every minute from instrumentation.ts on a long-running
// server, from GET /api/cron/schedule on serverless hosts, and opportunistically when rooms are loaded.

export const REMINDER_MINUTES = 20
// A room whose start time passed longer ago than this is left alone rather than opened late.
const AUTO_OPEN_GRACE_MS = 6 * 60 * 60_000

type ScheduledRoom = {
  _id: Types.ObjectId
  teacher: Types.ObjectId
  title: string
  code: string
  durationMinutes: number
  questionsPerStudent: number
  tfQuestions?: number | null
  codingQuestions?: number | null
  startsAt?: Date | null
  autoOpen?: boolean | null
  paperMode?: string | null
  setCount?: number | null
  bloomPlan?: { level: string; count?: number | null; marks?: number | null }[] | null
}
type TeacherInfo = { name: string; email: string }

const minutesUntil = (date: Date) => Math.max(0, Math.round((date.getTime() - Date.now()) / 60_000))
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

function roomDetails(room: ScheduledRoom): [string, string][] {
  const paper = [room.questionsPerStudent ? plural(room.questionsPerStudent, 'MCQ') : '', room.tfQuestions ? `${room.tfQuestions} True/False` : '', room.codingQuestions ? plural(room.codingQuestions, 'coding problem') : ''].filter(Boolean).join(' + ')
  return [
    ['Exam', room.title],
    ['Room code', room.code],
    ['Starts', formatWhen(room.startsAt!)],
    ['Duration', plural(room.durationMinutes, 'minute')],
    ...(paper ? [['Each student gets', paper] as [string, string]] : []),
    ['Auto-open', room.autoOpen ? 'On: opens by itself' : 'Off: you open it'],
  ]
}

async function send(teacher: TeacherInfo, subject: string, content: EmailContent) {
  await sendMail({ to: teacher.email, subject, ...renderEmail(content) })
}

const openButton = (room: ScheduledRoom) => ({ label: 'Go to the room', path: `/teacher/rooms/${room._id}` })

/** What the faculty member has to do before the start, as a call-out. */
async function readiness(room: ScheduledRoom): Promise<EmailContent['callout']> {
  const problem = await openProblem(room)
  const at = formatTime(room.startsAt!)
  if (room.autoOpen) return problem
    ? { tone: 'warn', text: `Auto-open is on, but the room can't open yet: ${problem} Fix this before ${at}, or students won't be able to start.` }
    : { text: `Auto-open is on, so the room opens for students at ${at}. You don't need to do anything.` }
  return { tone: 'warn', text: `Please open the room for students at ${at}; they can't start until you do.${problem ? ` Before that: ${problem}` : ''}` }
}

/**
 * Tells the faculty member their exam is scheduled (or moved). If it starts within the reminder window,
 * this email doubles as the reminder. Never throws: a failed email shouldn't undo saving the room.
 */
export async function notifyScheduled(room: ScheduledRoom, teacher: TeacherInfo, rescheduled: boolean) {
  if (!room.startsAt || room.startsAt.getTime() <= Date.now()) return
  try {
    const soon = minutesUntil(room.startsAt) <= REMINDER_MINUTES
    await send(teacher, `${rescheduled ? 'Rescheduled' : 'Scheduled'}: ${room.title} on ${formatWhen(room.startsAt)}`, {
      preview: `${room.title} starts ${formatWhen(room.startsAt)}. Room code ${room.code}.`,
      tag: rescheduled ? 'Exam rescheduled' : 'Exam scheduled',
      heading: rescheduled ? 'Your exam has a new time' : 'Your exam is scheduled',
      greeting: `Hi ${teacher.name},`,
      paragraphs: [
        `${room.title} is ${rescheduled ? 'now ' : ''}set to start on ${formatWhen(room.startsAt)}. Share the room code with your students so they can join.`,
        soon ? `It starts in ${plural(minutesUntil(room.startsAt), 'minute')}.` : `We'll email you again ${REMINDER_MINUTES} minutes before it starts.`,
      ],
      details: roomDetails(room),
      callout: soon ? await readiness(room) : room.autoOpen ? { text: `Auto-open is on: the room opens for students by itself at ${formatTime(room.startsAt)}.` } : undefined,
      button: openButton(room),
      footnote: 'You get this email because you scheduled this exam on the portal.',
    })
    if (soon) await ExamRoom.updateOne({ _id: room._id, startsAt: room.startsAt }, { reminderSentAt: new Date() })
  } catch (error) {
    console.error('[schedule] scheduled email failed:', error)
  }
}

async function sendReminder(room: ScheduledRoom, teacher: TeacherInfo) {
  const minutes = minutesUntil(room.startsAt!)
  await send(teacher, `Starts in ${plural(minutes, 'minute')}: ${room.title}`, {
    preview: room.autoOpen ? `${room.title} opens by itself at ${formatTime(room.startsAt!)}.` : `Please open the room for students at ${formatTime(room.startsAt!)}.`,
    tag: 'Exam reminder',
    heading: `Your exam starts in ${plural(minutes, 'minute')}`,
    greeting: `Hi ${teacher.name},`,
    paragraphs: [`${room.title} is scheduled for ${formatWhen(room.startsAt!)}.`],
    callout: await readiness(room),
    details: roomDetails(room),
    button: openButton(room),
  })
}

/** Opens the room if it's due and ready; tells the faculty member either way (the failure only once). */
async function autoOpen(room: ScheduledRoom & { autoOpenFailedAt?: Date | null }, teacher: TeacherInfo | null) {
  const problem = await openProblem(room)
  if (!problem) {
    const opened = await ExamRoom.findOneAndUpdate({ _id: room._id, status: 'draft', autoOpen: true }, { status: 'open', $unset: { endedAt: 1 } })
    if (opened && teacher) await send(teacher, `Now open: ${room.title}`, {
      preview: `${room.title} opened automatically. Students can join with code ${room.code}.`,
      tag: 'Room opened',
      heading: 'Your exam room is open',
      greeting: `Hi ${teacher.name},`,
      paragraphs: [`${room.title} opened automatically at its scheduled time. Students can now join with room code ${room.code}.`],
      details: roomDetails(room),
      button: { label: 'Monitor the exam', path: `/teacher/rooms/${room._id}` },
    }).catch(error => console.error('[schedule] opened email failed:', error))
    return
  }
  if (room.autoOpenFailedAt || !teacher) return
  // Claim the failure notice so parallel ticks send it once. Auto-open keeps retrying in case it gets fixed.
  if (!(await ExamRoom.findOneAndUpdate({ _id: room._id, autoOpenFailedAt: null }, { autoOpenFailedAt: new Date() }))) return
  await send(teacher, `Action needed: ${room.title} couldn't open`, {
    preview: `The room couldn't open automatically: ${problem}`,
    tag: 'Action needed',
    heading: "Your exam room couldn't open automatically",
    greeting: `Hi ${teacher.name},`,
    paragraphs: [`${room.title} was due to open at ${formatTime(room.startsAt!)}, but it isn't ready yet, so students can't start.`],
    callout: { tone: 'warn', text: problem },
    details: roomDetails(room),
    button: { label: 'Fix and open the room', path: `/teacher/rooms/${room._id}` },
    footnote: 'Once the problem is fixed, the room still opens by itself within a minute, or you can open it yourself.',
  }).catch(error => console.error('[schedule] auto-open failure email failed:', error))
}

/** Opens one room right away if auto-open is due (used when students look the room up). */
export async function autoOpenIfDue(room: ScheduledRoom & { status: string }) {
  if (room.status !== 'draft' || !room.autoOpen || !room.startsAt) return false
  const start = room.startsAt.getTime()
  if (start > Date.now() || start < Date.now() - AUTO_OPEN_GRACE_MS) return false
  await autoOpen(room, await Teacher.findById(room.teacher).select('name email').lean())
  return true
}

/** Sends due reminders and opens due rooms. Safe to run from several places at once. */
export async function runScheduleTick() {
  await connectDb()
  const now = Date.now()
  const teachers = new Map<string, TeacherInfo | null>()
  const teacherOf = async (id: Types.ObjectId) => {
    if (!teachers.has(String(id))) teachers.set(String(id), await Teacher.findById(id).select('name email').lean())
    return teachers.get(String(id))!
  }

  const reminders = await ExamRoom.find({ status: 'draft', reminderSentAt: null, startsAt: { $gt: new Date(now), $lte: new Date(now + REMINDER_MINUTES * 60_000) } }).select('-pool').lean()
  for (const room of reminders) {
    // Claim it first so two servers never both send it; release the claim if the email fails.
    const claimed = await ExamRoom.findOneAndUpdate({ _id: room._id, reminderSentAt: null, startsAt: room.startsAt }, { reminderSentAt: new Date() })
    if (!claimed) continue
    const teacher = await teacherOf(room.teacher)
    if (!teacher) continue
    try { await sendReminder(room, teacher) } catch (error) {
      console.error('[schedule] reminder failed:', error)
      await ExamRoom.updateOne({ _id: room._id }, { reminderSentAt: null })
    }
  }

  const due = await ExamRoom.find({ status: 'draft', autoOpen: true, startsAt: { $lte: new Date(now), $gte: new Date(now - AUTO_OPEN_GRACE_MS) } }).select('-pool').lean()
  for (const room of due) await autoOpen(room, await teacherOf(room.teacher))

  return { reminders: reminders.length, autoOpen: due.length }
}

let lastTick = 0
let running: Promise<unknown> | null = null

/** Runs the tick at most every 30 seconds per server instance; errors are logged, never thrown. */
export async function maybeRunScheduleTick() {
  if (running || Date.now() - lastTick < 30_000) return
  lastTick = Date.now()
  running = runScheduleTick().catch(error => console.error('[schedule] tick failed:', error)).finally(() => { running = null })
  await running
}

/**
 * Tells the faculty member their exam has ended, with a summary of how it went. Never throws: the
 * room is already closed and a failed email mustn't turn that into an error.
 */
export async function notifyExamEnded(
  room: { _id: Types.ObjectId; title: string; code: string; durationMinutes: number },
  teacher: TeacherInfo,
  stats: { joined: number; submitted: number; averagePercent: number | null; pendingReview: number; flagged: number },
  cutShort: number,
) {
  try {
    const details: [string, string][] = [
      ['Exam', room.title],
      ['Room code', room.code],
      ['Ended', formatWhen(new Date())],
      ['Students who took it', String(stats.submitted)],
      ...(stats.averagePercent != null ? [['Average score', `${stats.averagePercent}%`] as [string, string]] : []),
      ...(stats.flagged ? [['Flagged for rule breaks', plural(stats.flagged, 'student')] as [string, string]] : []),
      ...(stats.pendingReview ? [['Coding answers to grade', plural(stats.pendingReview, 'paper')] as [string, string]] : []),
    ]
    await send(teacher, `Exam ended: ${room.title}`, {
      preview: `${plural(stats.submitted, 'student')} took ${room.title}.${stats.averagePercent != null ? ` Average ${stats.averagePercent}%.` : ''}`,
      tag: 'Exam ended',
      heading: 'Your exam has ended',
      greeting: `Hi ${teacher.name},`,
      paragraphs: [
        stats.submitted ? `${room.title} is closed and every paper has been submitted. Here's how it went.` : `${room.title} is closed. No student took it.`,
        ...(cutShort ? [`${plural(cutShort, 'student was', 'students were')} still writing and ${cutShort === 1 ? 'was' : 'were'} submitted automatically with the answers saved so far.`] : []),
      ],
      details,
      callout: stats.pendingReview ? { tone: 'warn', text: `${plural(stats.pendingReview, 'paper')} still ${stats.pendingReview === 1 ? 'has' : 'have'} coding answers to grade. Students see their final score once you've graded them.` } : undefined,
      button: { label: 'View results', path: `/teacher/rooms/${room._id}?tab=leaderboard` },
      footnote: 'You can export the results as a spreadsheet from the room page.',
    })
  } catch (error) {
    console.error('[schedule] exam-ended email failed:', error)
  }
}

/** Confirms questions were saved, and for a room whether it's ready to open. Never throws. */
export async function notifyQuestionsAdded(
  teacher: TeacherInfo,
  room: (ScheduledRoom & { status: string }) | null,
  added: { mcq: number; tf?: number; coding: number; source: string },
) {
  try {
    const total = added.mcq + (added.tf ?? 0) + added.coding
    const what = [added.mcq ? plural(added.mcq, 'MCQ') : '', added.tf ? `${added.tf} True/False` : '', added.coding ? plural(added.coding, 'coding problem') : ''].filter(Boolean).join(' + ')
    const from = { ai: 'Generated with AI', csv: 'Imported from CSV', manual: 'Written manually' }[added.source] ?? 'Added'
    const problem = room && room.status !== 'closed' ? await openProblem(room) : null
    await send(teacher, `${plural(total, 'question')} added${room ? ` to ${room.title}` : ' to your question bank'}`, {
      preview: `${what} saved${room ? ` to ${room.title} (${room.code})` : ''}.`,
      tag: 'Questions added',
      heading: room ? 'Questions added to your exam' : 'Questions added to your bank',
      greeting: `Hi ${teacher.name},`,
      paragraphs: [room ? `${what} ${total === 1 ? 'was' : 'were'} saved to ${room.title}.` : `${what} ${total === 1 ? 'was' : 'were'} saved to your question bank. Copy them into any exam room when you need them.`],
      details: [['Added', what], ['Source', from], ...(room ? roomDetails(room) : [])],
      callout: room && room.status === 'draft'
        ? problem ? { tone: 'warn', text: `The room isn't ready to open yet: ${problem}` } : { text: 'The question pool is ready: every student can get a full paper.' }
        : undefined,
      button: room ? openButton(room) : { label: 'Open the question bank', path: '/teacher/questions' },
    })
  } catch (error) {
    console.error('[schedule] questions-added email failed:', error)
  }
}

/** Confirms a room was deleted. Never throws. */
export async function notifyRoomDeleted(room: { title: string; code: string; startsAt?: Date | null }, teacher: TeacherInfo, removed: { attempts: number; questions: number }) {
  try {
    await send(teacher, `Exam room deleted: ${room.title}`, {
      preview: `${room.title} (${room.code}) was deleted.`,
      tag: 'Room deleted',
      heading: 'Your exam room was deleted',
      greeting: `Hi ${teacher.name},`,
      paragraphs: [`${room.title} has been deleted, so its room code no longer works${room.startsAt && room.startsAt.getTime() > Date.now() ? ' and the scheduled exam is cancelled' : ''}.`],
      details: [
        ['Exam', room.title],
        ['Room code', room.code],
        ...(room.startsAt ? [['Was scheduled for', formatWhen(room.startsAt)] as [string, string]] : []),
        ['Student results removed', String(removed.attempts)],
        ['Questions kept in your bank', String(removed.questions)],
      ],
      button: { label: 'Open the question bank', path: '/teacher/questions' },
      footnote: "If you didn't delete this room, change your password right away.",
    })
  } catch (error) {
    console.error('[schedule] room-deleted email failed:', error)
  }
}

import 'server-only'
import { after } from 'next/server'
import type { Types } from 'mongoose'
import { buildAnalysis } from './analysis'
import type { MissedQuestion, ResultAnalysis } from './analysis-types'
import { connectDb } from './db'
import { formatWhen, renderEmail, type EmailContent } from './email-template'
import { resultsVisible } from './visibility'
import { sendMail } from './mail'
import { Attempt, ExamRoom } from './models'

type Id = Types.ObjectId | string

/** Runs email work after the response when inside a request (Vercel keeps it alive), otherwise right away. */
function later(task: () => Promise<unknown>) {
  const run = () => task().catch(error => console.error('[result-email]', error))
  try { after(run) } catch { void run() }
}

/**
 * After a student submits: the score and analysis if the room already shows results, otherwise an
 * "answers received" email (results follow when the exam ends, unless the faculty hides scores).
 */
export function emailAfterSubmit(attemptId: Id) {
  later(async () => {
    await connectDb()
    const attempt = await Attempt.findById(attemptId).select('room status autoSubmitted autoSubmitReason').lean()
    if (!attempt || attempt.status !== 'submitted') return
    const room = await ExamRoom.findById(attempt.room).select('showResults status').lean()
    if (room && resultsVisible(room, attempt)) await sendResult(attemptId)
    else await sendSubmitted(attemptId)
  })
}

/** When a room ends: results for everyone whose score has become visible and who hasn't had it yet. */
export function emailRoomResults(roomId: Id) {
  later(async () => {
    await connectDb()
    const room = await ExamRoom.findById(roomId).select('showResults status').lean()
    if (!room) return
    const attempts = await Attempt.find({ room: roomId, status: 'submitted', resultEmailedAt: null }).select('status autoSubmitted autoSubmitReason').lean()
    for (const attempt of attempts) {
      if (resultsVisible(room, attempt)) await sendResult(attempt._id).catch(error => console.error('[result-email] result failed:', error))
    }
  })
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'there'
const fmt = (value: number) => String(Math.round(value * 100) / 100)
const duration = (seconds: number | null) => (seconds == null ? '—' : seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`)

async function sendResult(attemptId: Id) {
  // Claim first so parallel triggers can't send it twice.
  const attempt = await Attempt.findOneAndUpdate({ _id: attemptId, resultEmailedAt: null }, { $set: { resultEmailedAt: new Date() } }, { returnDocument: 'after' })
  if (!attempt?.studentEmail) return
  const room = await ExamRoom.findById(attempt.room).select('title code').lean()
  try {
    const a = await buildAnalysis(attempt)
    const { subject, content } = resultEmail(attempt, room, a)
    await sendMail({ to: attempt.studentEmail, subject, ...renderEmail(content) })
  } catch (error) {
    // Let a later trigger (e.g. the room ending) try again.
    await Attempt.updateOne({ _id: attempt._id }, { $set: { resultEmailedAt: null } })
    throw error
  }
}

const clip = (value: string, max = 110) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value)

/** "Q7 · Which structure is LIFO? — you: B. Queue · correct: C. Stack" */
function missedLine(m: MissedQuestion) {
  if (m.type === 'coding') return `Q${m.number} · ${clip(m.text)} — ${m.marks ? `${fmt(m.marks.earned)} / ${fmt(m.marks.possible)} marks` : 'not attempted'}${m.feedback ? ` (${clip(m.feedback, 80)})` : ''}`
  return `Q${m.number} · ${clip(m.text)} — ${m.yourAnswer ? `you: ${clip(m.yourAnswer, 50)}` : 'skipped'} · correct: ${clip(m.correctAnswer ?? '—', 50)}`
}

type ResultAttempt = { _id: unknown; score: number; maxScore: number; studentName: string }

/** Subject and content of the results email (pure, so it can be previewed without sending). */
export function resultEmail(attempt: ResultAttempt, room: { title?: string; code?: string } | null, a: ResultAnalysis): { subject: string; content: EmailContent } {
  const title = room?.title ?? 'Your exam'
  const details: [string, string][] = [
    ['MCQ marks', `${fmt(a.mcq.earned)} / ${fmt(a.mcq.possible)}`],
    ...(a.coding.questions ? [['Coding marks', `${fmt(a.coding.earned)} / ${fmt(a.coding.possible)}${a.coding.pending ? ` (${a.coding.pending} being graded)` : ''}`] as [string, string]] : []),
    ['Correct · Wrong · Skipped', `${a.correct} · ${a.wrong} · ${a.skipped}`],
    ...(a.accuracy != null ? [['Accuracy', `${a.accuracy}% of attempted MCQs`] as [string, string]] : []),
    ...(a.negativeLost ? [['Lost to negative marking', fmt(a.negativeLost)] as [string, string]] : []),
    ['Time taken', `${duration(a.timeTakenSeconds)}${a.durationMinutes ? ` of ${a.durationMinutes} min` : ''}`],
    ...(a.classStats ? [
      ['Your rank', `${a.classStats.rank} of ${a.classStats.of}`] as [string, string],
      ['Class average · Top score', `${a.classStats.average}% · ${a.classStats.highest}%`] as [string, string],
    ] : []),
  ]
  const areaRow = (x: { label: string; percent: number; correct: number; questions: number; earned: number; possible: number; pending: number }) => ({
    label: x.label, percent: x.percent,
    detail: `${fmt(x.earned)} / ${fmt(x.possible)} marks · ${x.correct} of ${x.questions} right${x.pending ? ` · ${x.pending} being graded` : ''}`,
  })
  const content: EmailContent = {
    preview: `You scored ${fmt(attempt.score)} / ${fmt(attempt.maxScore)} (${a.percent}%) in ${title}.`,
    tag: 'Exam result',
    heading: `${title}: your result`,
    greeting: `Hi ${firstName(attempt.studentName)},`,
    paragraphs: [`Here's how you did in ${title}${room?.code ? ` (room ${room.code})` : ''}, with the areas you're strong in and the ones to work on.`],
    score: { value: `${fmt(attempt.score)} / ${fmt(attempt.maxScore)}`, caption: a.classStats ? `Rank ${a.classStats.rank} of ${a.classStats.of} · better than ${a.classStats.percentile}% of the class` : 'Marks scored', percent: a.percent, label: a.band.label },
    details,
    bars: [
      ...(a.byTopic.filter(t => t.possible > 0).length > 1 ? [{ title: 'By topic', rows: a.byTopic.filter(t => t.possible > 0).slice(0, 8).map(areaRow) }] : []),
      ...(a.byLevel.filter(l => l.possible > 0).length ? [{ title: "By Bloom's level", rows: a.byLevel.filter(l => l.possible > 0).map(areaRow) }] : []),
    ],
    lists: [
      ...(a.strong.length ? [{ title: 'Strong areas', tone: 'good' as const, items: a.strong.slice(0, 4).map(x => `${x.label} — ${x.percent}%`) }] : []),
      // One block per weak area: what to improve and the exact questions missed there.
      ...(a.focus.length
        ? a.focus.slice(0, 3).map(f => ({
          title: `You need to improve in ${f.area.label} (${f.area.percent}%)`,
          tone: 'bad' as const,
          items: [f.advice, ...f.missed.slice(0, 3).map(missedLine), ...(f.missed.length > 3 ? [`…and ${f.missed.length - 3} more in the full analysis`] : [])],
        }))
        : a.weak.length ? [{ title: 'Areas to improve', tone: 'bad' as const, items: a.weak.slice(0, 4).map(x => `${x.label} — ${x.percent}%`) }] : []),
      ...(a.tips.length ? [{ title: 'What to work on', tone: 'info' as const, items: a.tips }] : []),
    ],
    button: { label: 'View full analysis', path: `/student/results/${attempt._id}` },
    footnote: a.coding.pending ? 'Some coding answers are still being graded by your faculty, so your final score may go up.' : 'Scores are final unless your faculty re-grades a question.',
  }
  return { subject: `Your result: ${title} — ${fmt(attempt.score)}/${fmt(attempt.maxScore)} (${a.percent}%)`, content }
}

async function sendSubmitted(attemptId: Id) {
  const attempt = await Attempt.findOneAndUpdate({ _id: attemptId, submissionEmailedAt: null }, { $set: { submissionEmailedAt: new Date() } }, { returnDocument: 'after' })
  if (!attempt?.studentEmail) return
  const room = await ExamRoom.findById(attempt.room).select('title code showResults').lean()
  const title = room?.title ?? 'Your exam'
  const suspended = attempt.autoSubmitted && (attempt.autoSubmitReason === 'violations' || attempt.autoSubmitReason === 'faculty')
  const how = !attempt.autoSubmitted ? 'You submitted it yourself.'
    : { time: 'It was submitted automatically when time ran out.', violations: 'It was submitted automatically after too many exam-rule violations.', faculty: 'It was submitted by your faculty.', room_closed: 'It was submitted automatically when the exam was ended.' }[attempt.autoSubmitReason as string] ?? 'It was submitted automatically.'
  const next = suspended ? 'Your result is withheld. Contact your faculty if you think this is a mistake.'
    : room?.showResults === 'never' ? 'Your faculty has chosen not to publish scores for this exam.'
    : 'Your score and a detailed analysis of your strong and weak areas will be emailed to you when the exam ends.'
  const content: EmailContent = {
    preview: `Your answers for ${title} were submitted.`,
    tag: 'Answers received',
    heading: `${title}: answers received`,
    greeting: `Hi ${firstName(attempt.studentName)},`,
    paragraphs: [`We've received your answers for ${title}${room?.code ? ` (room ${room.code})` : ''}. ${how}`],
    details: [
      ['Submitted', attempt.submittedAt ? formatWhen(attempt.submittedAt) : '—'],
      ['Questions', String(attempt.questions.length)],
    ],
    callout: { tone: suspended ? 'warn' : 'info', text: next },
    button: { label: 'Open your exams', path: `/student/results/${attempt._id}` },
  }
  try {
    await sendMail({ to: attempt.studentEmail, subject: `Answers received: ${title}`, ...renderEmail(content) })
  } catch (error) {
    await Attempt.updateOne({ _id: attempt._id }, { $set: { submissionEmailedAt: null } })
    throw error
  }
}

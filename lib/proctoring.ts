import 'server-only'
import { randomBytes } from 'node:crypto'
import { HttpError, clientIp } from './auth'
import { submitAttempt } from './exams'
import { INTEGRITY_EVENTS, normalizeFlags, violationCount, type IntegrityEvent } from './integrity'
import { Attempt, ExamRoom } from './models'

type AttemptDoc = NonNullable<Awaited<ReturnType<typeof Attempt.findOne>>>

export const SESSION_HEADER = 'x-exam-session'
const MAX_EVENTS = 300

/**
 * Makes this browser tab the only one allowed to write to the attempt. If a different tab or
 * device was active in the last 90 seconds, that's recorded as a "multiple sessions" flag
 * (refreshing the same tab is not). Also tracks the IP addresses the exam is taken from.
 */
export async function claimSession(attempt: AttemptDoc, request: Request, tabId: string) {
  const ip = clientIp(request)
  const userAgent = (request.headers.get('user-agent') ?? '').slice(0, 300)
  const key = randomBytes(18).toString('base64url')
  const tab = tabId.slice(0, 64)
  const sameTab = Boolean(tab) && attempt.sessionTab === tab
  const recentlyActive = !sameTab && attempt.sessionKey && attempt.lastSeenAt && Date.now() - attempt.lastSeenAt.getTime() < 90_000
  const newIp = attempt.ipAddresses.length > 0 && !attempt.ipAddresses.includes(ip)

  const update: Record<string, unknown> = { $set: { sessionKey: key, sessionTab: tab, userAgent, lastSeenAt: new Date() }, $addToSet: { ipAddresses: ip } }
  const inc: Record<string, number> = {}
  const events: { type: IntegrityEvent; at: Date; detail: string }[] = []
  if (recentlyActive) { inc['flags.multiple_sessions'] = 1; events.push({ type: 'multiple_sessions', at: new Date(), detail: `Opened again from ${ip}` }) }
  if (newIp) { inc['flags.ip_change'] = 1; events.push({ type: 'ip_change', at: new Date(), detail: `${attempt.ipAddresses.at(-1)} → ${ip}` }) }
  if (Object.keys(inc).length) { update.$inc = inc; update.$push = { events: { $each: events, $slice: -MAX_EVENTS } } }

  await Attempt.updateOne({ _id: attempt._id }, update)
  if (recentlyActive) await enforceLimit(String(attempt._id))
  return key
}

/** Rejects writes from a tab that is no longer the active session. */
export function assertSession(attempt: AttemptDoc, request: Request) {
  if (!attempt.sessionKey) return
  if (request.headers.get(SESSION_HEADER) !== attempt.sessionKey) {
    throw new HttpError(409, 'This exam is open in another tab or on another device.', 'session_taken')
  }
}

/** Records one proctoring signal and auto-submits if the room's violation limit is reached. */
export async function recordEvent(attemptId: string, type: IntegrityEvent, detail = '') {
  const updated = await Attempt.findOneAndUpdate(
    { _id: attemptId, status: 'in_progress' },
    {
      $inc: { [`flags.${type}`]: 1, ...(type === 'tab_switch' ? { tabSwitches: 1 } : {}) },
      $push: { events: { $each: [{ type, at: new Date(), detail: detail.slice(0, 200) }], $slice: -MAX_EVENTS } },
      $set: { lastSeenAt: new Date() },
    },
    { returnDocument: 'after' },
  )
  if (!updated) return null
  if (INTEGRITY_EVENTS[type].violation) await enforceLimit(attemptId)
  return Attempt.findById(attemptId)
}

async function enforceLimit(attemptId: string) {
  const attempt = await Attempt.findById(attemptId)
  if (!attempt || attempt.status !== 'in_progress') return
  const room = await ExamRoom.findById(attempt.room).select('maxViolations').lean()
  const limit = room?.maxViolations ?? 0
  if (limit > 0 && violationCount(normalizeFlags(attempt.flags, attempt.tabSwitches)) >= limit) {
    await submitAttempt(attempt, { auto: true, reason: 'violations' })
  }
}

/** Proctoring summary for API responses. */
export function integrityOf(attempt: { flags?: unknown; tabSwitches?: number | null }) {
  const flags = normalizeFlags(attempt.flags, attempt.tabSwitches)
  return { flags, violations: violationCount(flags) }
}

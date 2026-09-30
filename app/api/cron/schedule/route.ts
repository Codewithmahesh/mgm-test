import { NextResponse } from 'next/server'
import { HttpError, handler } from '@/lib/auth'
import { runGenerationTick } from '@/lib/generation-jobs'
import { runScheduleTick } from '@/lib/schedule'

export const maxDuration = 300

/**
 * GET /api/cron/schedule — sends due exam reminders, auto-opens due rooms and runs background AI generations. Call it every minute from
 * a cron (Vercel Cron, cron-job.org…) with "Authorization: Bearer <CRON_SECRET>".
 */
export const GET = handler(async (request: Request) => {
  // CRON_SECRET for an external cron; INTERNAL_TICK_SECRET for this server's own timer (instrumentation.ts).
  const secrets = [process.env.CRON_SECRET, process.env.INTERNAL_TICK_SECRET].filter(Boolean)
  if (!secrets.length) throw new HttpError(503, 'CRON_SECRET is not set on the server.')
  if (!secrets.some(secret => request.headers.get('authorization') === `Bearer ${secret}`)) throw new HttpError(401, 'Unauthorized.')
  const schedule = await runScheduleTick()
  return NextResponse.json({ ok: true, ...schedule, ...(await runGenerationTick(240_000)) })
})

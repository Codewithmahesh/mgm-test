/**
 * On a long-running server (next start, next dev, a VPS…) check every minute for scheduled-exam work
 * (20-minute reminders, auto-opening rooms) and background AI generations.
 *
 * The work itself runs in GET /api/cron/schedule, not here: code loaded by instrumentation lives in its
 * own module graph (with its own database connection state) and isn't hot-reloaded in development, so
 * the timer just calls the app's own endpoint with a secret made at startup.
 * Serverless hosts such as Vercel don't keep timers alive; there an external cron calls the endpoint.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.VERCEL || process.env.NEXT_PHASE === 'phase-production-build') return
  const secret = (process.env.INTERNAL_TICK_SECRET ??= crypto.randomUUID())
  let busy = false
  setInterval(async () => {
    if (busy) return
    busy = true
    try {
      const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/cron/schedule`, { headers: { authorization: `Bearer ${secret}` }, cache: 'no-store' })
      if (!response.ok) console.error('[schedule] tick failed:', response.status, (await response.text()).slice(0, 300))
    } catch (error) {
      console.error('[schedule] tick request failed:', error instanceof Error ? error.message : error)
    } finally {
      busy = false
    }
  }, 60_000).unref()
}

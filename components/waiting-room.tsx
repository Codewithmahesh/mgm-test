'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Clock3, DoorOpen, UserCheck, UserX, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { useFeedback } from '@/components/ui/overlay'
import { api, errorMessage, initials, relativeTime } from '@/lib/api'
import { useLatestRequest } from '@/lib/use-latest'
import { cn } from '@/lib/utils'

export type JoinRow = { id: string; studentName: string; studentEmail: string; rollNumber: string; className: string; status: 'pending' | 'admitted' | 'rejected'; started: boolean; requestedAt: string; decidedAt: string | null }
export type WaitingData = { requireApproval: boolean; pending: JoinRow[]; admittedWaiting: JoinRow[]; rejected: JoinRow[]; counts: { pending: number; admitted: number } }

const POLL_MS = 3000

/** Short two-note chime (Web Audio) so faculty notice new requests without watching the screen. */
function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    ;[660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      osc.type = 'sine'
      const at = ctx.currentTime + i * 0.14
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25)
      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + 0.3)
    })
    window.setTimeout(() => ctx.close().catch(() => {}), 800)
  } catch { /* audio not available */ }
}

/**
 * Polls the room's waiting room every 3 seconds (while the tab is visible), so new join requests
 * appear without a page refresh. Announces new requests with a toast, a chime and the tab title.
 */
export function useWaitingRoom(roomId: string, active: boolean) {
  const { toast } = useFeedback()
  const latest = useLatestRequest()
  const [data, setData] = useState<WaitingData | null>(null)
  const seen = useRef<Set<string> | null>(null)

  const load = useCallback(() => latest(api<WaitingData>(`/api/rooms/${roomId}/requests`), next => {
    const ids = new Set(next.pending.map(r => r.id))
    if (seen.current) {
      const fresh = next.pending.filter(r => !seen.current!.has(r.id))
      if (fresh.length) {
        toast(fresh.length === 1 ? `${fresh[0].studentName} is asking to join.` : `${fresh.length} students are asking to join.`, 'info')
        chime()
      }
    }
    seen.current = ids
    setData(next)
  }).catch(() => {}), [roomId, latest, toast])

  useEffect(() => {
    if (!active) return
    load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [active, load])

  // "(3) " in the browser tab title while students are waiting.
  const pending = data?.counts.pending ?? 0
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, '')
    document.title = pending ? `(${pending}) ${base}` : base
    return () => { document.title = document.title.replace(/^\(\d+\) /, '') }
  }, [pending])

  const act = useCallback(async (action: 'admit' | 'reject', target: { ids: string[] } | { all: true }) => {
    // Update the list immediately, then confirm with the server.
    setData(current => {
      if (!current) return current
      const chosen = new Set('all' in target ? current.pending.map(r => r.id) : target.ids)
      const moved = [...current.pending, ...current.rejected].filter(r => chosen.has(r.id)).map(r => ({ ...r, status: action === 'admit' ? 'admitted' as const : 'rejected' as const }))
      const pendingLeft = current.pending.filter(r => !chosen.has(r.id))
      return {
        ...current,
        pending: pendingLeft,
        rejected: action === 'reject' ? [...current.rejected, ...moved] : current.rejected.filter(r => !chosen.has(r.id)),
        admittedWaiting: action === 'admit' ? [...current.admittedWaiting, ...moved] : current.admittedWaiting,
        counts: { ...current.counts, pending: pendingLeft.length },
      }
    })
    try {
      const result = await api<{ updated: number }>(`/api/rooms/${roomId}/requests`, { method: 'PATCH', body: { action, ...target } })
      toast(action === 'admit' ? `${result.updated} student${result.updated === 1 ? '' : 's'} admitted.` : `${result.updated} request${result.updated === 1 ? '' : 's'} declined.`)
    } catch (err) { toast(errorMessage(err), 'error') }
    load()
  }, [roomId, toast, load])

  return { data, reload: load, act }
}

export function WaitingRoomCard({ code, data, act }: { code: string; data: WaitingData | null; act: ReturnType<typeof useWaitingRoom>['act'] }) {
  const [now, setNow] = useState(Date.now())
  const [showDeclined, setShowDeclined] = useState(false)
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(t) }, [])
  if (!data) return null
  const { pending, admittedWaiting, rejected } = data

  return (
    <Card className={cn('overflow-hidden transition-colors', pending.length > 0 && 'border-primary-border')}>
      <CardHeader
        title={<span className="flex items-center gap-2">Waiting room {pending.length > 0 && <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" /><span className="relative size-2 rounded-full bg-primary" /></span>}</span>}
        description={pending.length ? `${pending.length} student${pending.length === 1 ? ' is' : 's are'} asking to join · updates automatically` : 'Students who request to join appear here instantly'}
        action={pending.length > 0 && <>
          <Button variant="ghost" size="sm" onClick={() => act('reject', { all: true })}><UserX />Decline all</Button>
          <Button variant="success" size="sm" onClick={() => act('admit', { all: true })}><UserCheck />Admit all ({pending.length})</Button>
        </>}
      />
      {pending.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-6 text-sm text-muted-foreground">
          <span className="flex size-9 items-center justify-center rounded-lg bg-muted"><DoorOpen className="size-4" /></span>
          <span>No one is waiting. Students enter code <span className="font-mono font-semibold text-foreground">{code}</span> and tap <b className="font-medium text-foreground">Request to join</b>.</span>
        </div>
      ) : (
        <ul>
          {pending.map(row => (
            <li key={row.id} className="flex flex-col gap-3 border-b border-border px-5 py-3 animate-in fade-in slide-in-from-top-1 duration-300 last:border-0 sm:flex-row sm:items-center">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-ink">{initials(row.studentName)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.studentName}</p>
                <p className="truncate text-xs text-muted-foreground">{[row.rollNumber && `Roll ${row.rollNumber}`, row.className, row.studentEmail].filter(Boolean).join(' · ')}</p>
              </div>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={new Date(row.requestedAt).toLocaleTimeString()}><Clock3 className="size-3.5" />waiting {Math.max(0, Math.round((now - new Date(row.requestedAt).getTime()) / 60000))} min</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => act('reject', { ids: [row.id] })}><X />Decline</Button>
                <Button variant="success" size="sm" onClick={() => act('admit', { ids: [row.id] })}><Check />Admit</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {(admittedWaiting.length > 0 || rejected.length > 0) && (
        <div className="flex flex-col gap-2 border-t border-border bg-muted/40 px-5 py-3 text-xs">
          {admittedWaiting.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 flex items-center gap-1 font-medium text-muted-foreground"><Users className="size-3.5" />Admitted, not started yet:</span>
              {admittedWaiting.map(r => <Badge key={r.id} tone="green">{r.studentName}</Badge>)}
            </div>
          )}
          {rejected.length > 0 && (
            <div>
              <button onClick={() => setShowDeclined(v => !v)} className="font-medium text-muted-foreground hover:text-foreground">{showDeclined ? 'Hide' : 'Show'} declined ({rejected.length})</button>
              {showDeclined && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {rejected.map(r => (
                    <span key={r.id} className="inline-flex items-center gap-2 rounded-full border border-border bg-card py-0.5 pl-2.5 pr-1">
                      {r.studentName} <span className="text-muted-foreground">· {relativeTime(r.decidedAt)}</span>
                      <button onClick={() => act('admit', { ids: [r.id] })} className="rounded-full px-2 py-0.5 font-medium text-success hover:bg-success-soft">Admit</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

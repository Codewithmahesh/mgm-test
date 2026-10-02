'use client'

import Link from 'next/link'
import { Suspense, use, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CirclePause, Clock3, Download, MoreHorizontal, Play, RotateCcw, Square } from 'lucide-react'
import { CopyCode, RoomStatusBadge } from '@/components/common'
import { LeaderboardTab, OverviewTab, ParticipantsTab, QuestionsTab, SettingsTab } from '@/components/room-tabs'
import { WaitingRoomCard, useWaitingRoom } from '@/components/waiting-room'
import { Button } from '@/components/ui/button'
import { PageLoader } from '@/components/ui/card'
import { Alert, Field, Input } from '@/components/ui/form'
import { Dialog, Menu, MenuItem, Tabs, useFeedback } from '@/components/ui/overlay'
import { api, downloadFile, errorMessage, formatDate, paperSummary, type BankQuestion, type Room } from '@/lib/api'
import { useLatestRequest } from '@/lib/use-latest'

type Tab = 'overview' | 'questions' | 'participants' | 'leaderboard' | 'settings'
const TABS: Tab[] = ['overview', 'questions', 'participants', 'leaderboard', 'settings']

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <Suspense fallback={<PageLoader />}><RoomView id={id} /></Suspense>
}

function RoomView({ id }: { id: string }) {
  const router = useRouter()
  const search = useSearchParams()
  const { toast, confirm } = useFeedback()
  const [room, setRoom] = useState<Room | null>(null)
  const [questions, setQuestions] = useState<BankQuestion[]>([])
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>(() => (TABS.includes(search.get('tab') as Tab) ? (search.get('tab') as Tab) : 'overview'))
  const [extendOpen, setExtendOpen] = useState(false)
  const [extendBy, setExtendBy] = useState('10')
  // The status change or extension in progress, for the button spinners.
  const [busy, setBusy] = useState<Room['status'] | 'extend' | null>(null)

  const latest = useLatestRequest()
  const load = useCallback(() => latest(api<{ room: Room; questions: BankQuestion[] }>(`/api/rooms/${id}`), d => { setRoom(d.room); setQuestions(d.questions) }).catch(err => setError(errorMessage(err))), [id, latest])
  useEffect(() => { load() }, [load])
  // Live waiting room: checks for join requests every few seconds while the room is open.
  const waiting = useWaitingRoom(id, room?.status === 'open' && (room?.requireApproval ?? true))
  const pendingCount = waiting.data?.counts.pending ?? 0

  function changeTab(next: Tab) {
    setTab(next)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', next)
    url.searchParams.delete('new')
    window.history.replaceState(null, '', url)
  }

  async function setStatus(status: Room['status']) {
    if (!room) return
    if (status === 'closed' && !(await confirm({ title: 'End this exam?', description: 'Everyone still writing is submitted immediately and no one else can join.', confirmLabel: 'End exam', tone: 'danger' }))) return
    // Opening before the scheduled start: students can't start until the start time, so opening early
    // means starting now.
    const early = status === 'open' && room.startsAt && new Date(room.startsAt).getTime() > Date.now() + 60_000
    if (early && !(await confirm({
      title: 'Open this exam before its scheduled time?',
      description: <>This exam is scheduled for <b>{formatDate(room.startsAt, true)}</b>{room.autoOpen ? ' and is set to open automatically then' : ''}. Opening it now starts the exam <b>right away</b>: the start time changes to now and students can join and begin immediately.</>,
      confirmLabel: 'Yes, open now',
      cancelLabel: 'Keep the schedule',
      tone: 'danger',
    }))) return
    setBusy(status)
    try {
      const data = await api<{ room: Room }>(`/api/rooms/${id}`, { method: 'PATCH', body: early ? { status, startsAt: new Date().toISOString() } : { status } })
      setRoom(data.room)
      toast(status === 'open' ? `Room is live. Students can join with ${data.room.code}.` : status === 'closed' ? 'Exam ended. All papers are submitted.' : 'Room moved back to draft.')
    } catch (err) { toast(errorMessage(err), 'error') } finally { setBusy(null) }
  }

  async function extend() {
    setBusy('extend')
    try {
      await api(`/api/rooms/${id}`, { method: 'PATCH', body: { extendMinutes: Number(extendBy) } })
      toast(`Added ${extendBy} minutes for everyone still writing.`)
      setExtendOpen(false)
    } catch (err) { toast(errorMessage(err), 'error') } finally { setBusy(null) }
  }

  if (error) return <Alert>{error}</Alert>
  if (!room) return <PageLoader />

  return (
    <>
      <div className="mb-6">
        <Link href="/teacher/rooms" className="text-[13px] text-muted-foreground hover:text-foreground">Exam rooms</Link>
        <div className="mt-1.5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-medium tracking-tight">{room.title}</h1>
              <RoomStatusBadge status={room.status} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
              <span className="flex items-center gap-2">Code <CopyCode code={room.code} /></span>
              <span className="flex items-center gap-1.5"><Clock3 className="size-3.5" />{room.durationMinutes} min</span>
              <span>{paperSummary(room)} per student</span>
              {room.description && <span className="truncate">{room.description}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {room.status === 'draft' && <Button loading={busy === 'open'} disabled={busy !== null} onClick={() => setStatus('open')}><Play />{busy === 'open' ? 'Opening…' : 'Open room'}</Button>}
            {room.status === 'open' && <>
              <Button variant="outline" onClick={() => setExtendOpen(true)}><Clock3 />Extend time</Button>
              <Button variant="destructive" loading={busy === 'closed'} disabled={busy !== null} onClick={() => setStatus('closed')}><Square />{busy === 'closed' ? 'Ending…' : 'End exam'}</Button>
            </>}
            {room.status === 'closed' && <>
              <Button variant="outline" onClick={() => downloadFile(`/api/rooms/${id}/attempts?format=csv`)}><Download />Export results</Button>
              <Button variant="outline" loading={busy === 'open'} disabled={busy !== null} onClick={() => setStatus('open')}><RotateCcw />{busy === 'open' ? 'Reopening…' : 'Reopen'}</Button>
            </>}
            <Menu trigger={props => <Button variant="outline" size="icon" aria-label="More actions" {...props}><MoreHorizontal /></Button>}>
              {close => <>
                {room.status === 'open' && <MenuItem icon={CirclePause} onClick={() => { close(); setStatus('draft') }}>Pause (stop new joins)</MenuItem>}
                <MenuItem icon={Download} onClick={() => { close(); downloadFile(`/api/rooms/${id}/attempts?format=csv`) }}>Export results (CSV)</MenuItem>
                <MenuItem onClick={() => { close(); changeTab('settings') }}>Edit settings</MenuItem>
              </>}
            </Menu>
          </div>
        </div>
      </div>

      <Tabs className="mb-6" value={tab} onChange={changeTab} tabs={[
        { value: 'overview', label: 'Overview' },
        { value: 'questions', label: 'Questions', count: room.poolSize },
        { value: 'participants', label: <span className="flex items-center gap-2">Participants{pendingCount > 0 && <span className="rounded-full bg-primary px-1.5 py-px text-[11px] font-semibold text-primary-foreground animate-in zoom-in">{pendingCount} waiting</span>}</span>, count: room.joined },
        { value: 'leaderboard', label: 'Leaderboard' },
        { value: 'settings', label: 'Settings' },
      ]} />

      {pendingCount > 0 && tab !== 'participants' && (
        <button onClick={() => changeTab('participants')} className="mb-6 flex w-full items-center justify-between gap-3 rounded-lg border border-primary-border bg-primary-soft px-4 py-3 text-left text-sm text-primary-ink animate-in fade-in slide-in-from-top-1">
          <span className="flex items-center gap-2.5"><span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" /><span className="relative size-2 rounded-full bg-primary" /></span><b className="font-semibold">{pendingCount} student{pendingCount === 1 ? ' is' : 's are'} waiting to be admitted.</b></span>
          <span className="font-medium underline">Open waiting room</span>
        </button>
      )}

      {tab === 'participants' && room.status === 'open' && (room.requireApproval ?? true) && <div className="mb-6"><WaitingRoomCard code={room.code} data={waiting.data} act={waiting.act} /></div>}

      {tab === 'overview' && <OverviewTab room={room} onGo={changeTab} />}
      {tab === 'questions' && <QuestionsTab room={room} questions={questions} onRemoved={questionId => setQuestions(list => list.filter(q => q.id !== questionId))} onChanged={load} autoOpen={search.get('new') === '1'} />}
      {tab === 'participants' && <ParticipantsTab room={room} onChanged={load} />}
      {tab === 'leaderboard' && <LeaderboardTab room={room} />}
      {tab === 'settings' && <SettingsTab room={room} onSaved={next => { setRoom(next); load() }} onDeleted={() => router.push('/teacher/rooms')} />}

      <Dialog open={extendOpen} onClose={() => setExtendOpen(false)} size="sm" title="Extend time" description="Adds time for every student who is still writing."
        footer={<><Button variant="outline" onClick={() => setExtendOpen(false)}>Cancel</Button><Button onClick={extend} loading={busy === 'extend'}>Add {extendBy} minutes</Button></>}>
        <Field label="Minutes to add"><Input type="number" min={1} max={180} value={extendBy} onChange={e => setExtendBy(e.target.value)} /></Field>
      </Dialog>
    </>
  )
}

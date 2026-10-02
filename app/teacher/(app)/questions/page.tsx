'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { BookOpen, ChevronDown, Code2, DoorOpen, Download, Eye, FileText, Inbox, ListChecks, Loader2, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { AddQuestions, type AddMethod } from '@/components/add-questions'
import { RoomStatusBadge } from '@/components/common'
import { PaperView } from '@/components/paper-view'
import { QuestionCard } from '@/components/question-card'
import { QuestionEditor } from '@/components/question-editor'
import { QuestionAttachmentButton } from '@/components/question-attachment'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge, Card, EmptyState, PageHeader, Spinner, StatCard } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/form'
import { Menu, MenuItem, useFeedback } from '@/components/ui/overlay'
import { api, errorMessage, relativeTime, type BankQuestion, type DraftQuestion, type RoomStatus } from '@/lib/api'
import { downloadPaperPdf, type PaperMeta } from '@/lib/paper-pdf'
import { cn } from '@/lib/utils'

type Group = {
  key: string
  room: { id: string; title: string; code: string; status: RoomStatus; description: string; durationMinutes: number; questionsPerStudent: number; tfQuestions?: number; codingQuestions: number; marksPerQuestion: number; negativeMarks: number; codingMarks: number } | null
  total: number
  mcq: number
  tf: number
  coding: number
  lastAdded: string
  topics: string[]
  sources: string[]
}

const groupTitle = (g: Group) => g.room?.title ?? (g.key === 'unassigned' ? 'Not in any exam room' : 'Deleted exam room')
const metaOf = (g: Group): PaperMeta => ({
  title: groupTitle(g),
  code: g.room?.code,
  description: g.room?.description,
  durationMinutes: g.room?.durationMinutes,
  marksPerQuestion: g.room?.marksPerQuestion,
  negativeMarks: g.room?.negativeMarks,
  codingMarks: g.room?.codingMarks,
})

function QuestionBank() {
  const search = useSearchParams()
  const { toast, confirm } = useFeedback()
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [questions, setQuestions] = useState<Record<string, BankQuestion[] | undefined>>({})
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [type, setType] = useState('')
  const [adding, setAdding] = useState<AddMethod | null>(() => (['ai', 'csv', 'manual'].includes(search.get('add') ?? '') ? (search.get('add') as AddMethod) : null))
  const [editing, setEditing] = useState<{ group: string; question: BankQuestion } | null>(null)
  const [viewing, setViewing] = useState<Group | null>(null)

  const loadGroups = useCallback(() => api<{ groups: Group[] }>('/api/questions/groups').then(d => setGroups(d.groups)).catch(err => toast(errorMessage(err), 'error')), [toast])
  useEffect(() => { loadGroups() }, [loadGroups])

  /** All questions of one group, in paper order (MCQ/TF first, then coding). Cached. */
  const fetchGroup = useCallback(async (key: string, force = false) => {
    if (!force && questions[key]) return questions[key]!
    const all: BankQuestion[] = []
    for (let page = 1; page < 50; page++) {
      const data = await api<{ questions: BankQuestion[]; total: number }>(`/api/questions?room=${key}&order=paper&limit=500&page=${page}`)
      all.push(...data.questions)
      if (all.length >= data.total || !data.questions.length) break
    }
    // Paper order: objective questions first, coding problems last.
    const ordered = [...all.filter(q => q.type !== 'coding'), ...all.filter(q => q.type === 'coding')]
    setQuestions(map => ({ ...map, [key]: ordered }))
    return ordered
  }, [questions])

  function toggle(key: string) {
    setOpen(set => { const next = new Set(set); if (next.has(key)) next.delete(key); else { next.add(key); fetchGroup(key).catch(err => toast(errorMessage(err), 'error')) } return next })
  }

  // The exam group whose PDF is being built.
  const [downloading, setDownloading] = useState<string | null>(null)

  async function refresh(key?: string) {
    await loadGroups()
    if (key) await fetchGroup(key, true)
  }

  async function removeGroup(group: Group) {
    const ok = await confirm({
      title: `Delete all ${group.total} question${group.total === 1 ? '' : 's'} in “${groupTitle(group)}”?`,
      description: group.room ? 'The exam room itself stays, but its question pool will be empty. Papers students already received are not changed.' : 'These questions are removed from your bank permanently.',
      confirmLabel: 'Delete questions',
      tone: 'danger',
    })
    if (!ok) return
    setGroups(list => list?.filter(g => g.key !== group.key) ?? null)
    try { const d = await api<{ deleted: number }>('/api/questions', { method: 'DELETE', body: { room: group.key } }); toast(`${d.deleted} question${d.deleted === 1 ? '' : 's'} deleted.`) } catch (err) { toast(errorMessage(err), 'error') }
    setQuestions(map => ({ ...map, [group.key]: undefined }))
    loadGroups()
  }

  async function removeQuestion(group: string, question: BankQuestion) {
    if (!(await confirm({ title: 'Delete this question?', description: 'It is removed from the bank and from its exam room.', confirmLabel: 'Delete', tone: 'danger' }))) return
    setQuestions(map => ({ ...map, [group]: map[group]?.filter(q => q.id !== question.id) }))
    try { await api(`/api/questions/${question.id}`, { method: 'DELETE' }); toast('Question deleted.') } catch (err) { toast(errorMessage(err), 'error') }
    loadGroups()
  }

  async function save(question: DraftQuestion) {
    if (!editing) return
    await api(`/api/questions/${editing.question.id}`, { method: 'PATCH', body: question })
    toast('Question updated.')
    refresh(editing.group)
  }

  async function download(group: Group, withAnswers: boolean) {
    setDownloading(group.key)
    try {
      const list = await fetchGroup(group.key)
      if (!list.length) throw new Error('There are no questions to export.')
      await downloadPaperPdf(metaOf(group), list, { withAnswers })
      toast(withAnswers ? 'Paper with answers downloaded.' : 'Question paper downloaded.')
    } catch (err) { toast(errorMessage(err, 'Could not create the PDF.'), 'error') } finally { setDownloading(null) }
  }

  const visible = useMemo(() => (groups ?? []).filter(g => {
    if (type === 'coding' && !g.coding) return false
    if (type === 'mcq' && !g.mcq) return false
    if (type === 'tf' && !g.tf) return false
    const q = query.trim().toLowerCase()
    return !q || `${groupTitle(g)} ${g.room?.code ?? ''} ${g.topics.join(' ')}`.toLowerCase().includes(q)
  }), [groups, query, type])

  const totals = useMemo(() => (groups ?? []).reduce((t, g) => ({ total: t.total + g.total, mcq: t.mcq + g.mcq + g.tf, coding: t.coding + g.coding }), { total: 0, mcq: 0, coding: 0 }), [groups])

  return (
    <>
      <PageHeader title="Question bank" description="Your questions, grouped by exam. View a paper, download it as a PDF, or edit it." actions={<Button onClick={() => setAdding('ai')}><Plus />Add questions</Button>} />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Questions" value={totals.total} icon={BookOpen} />
        <StatCard label="Exam groups" value={groups?.filter(g => g.room).length ?? 0} icon={DoorOpen} tone="violet" />
        <StatCard label="Objective (MCQ + T/F)" value={totals.mcq} icon={ListChecks} tone="green" />
        <StatCard label="Coding problems" value={totals.coding} icon={Code2} tone="amber" />
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" /><Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search exams by name, code or topic" className="pl-9" /></div>
        <Select value={type} onChange={e => setType(e.target.value)} className="sm:w-48" aria-label="Question type"><option value="">All question types</option><option value="mcq">Has MCQs</option><option value="tf">Has true / false</option><option value="coding">Has coding</option></Select>
      </div>

      {!groups ? <div className="flex justify-center py-20"><Spinner /></div> : visible.length === 0 ? (
        <Card><EmptyState icon={BookOpen} title={groups.length ? 'No exams match' : 'Your question bank is empty'} description={groups.length ? 'Try a different search.' : 'Generate questions with AI from a PDF or notes, or import a CSV.'} action={!groups.length && <Button onClick={() => setAdding('ai')}><Plus />Add questions</Button>} /></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((group, i) => {
            const expanded = open.has(group.key)
            const list = questions[group.key]
            const shown = list?.filter(q => !type || q.type === type)
            return (
              <Card key={group.key} className="overflow-hidden animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-300" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                  <button onClick={() => toggle(group.key)} className="flex min-w-0 flex-1 items-center gap-4 text-left" aria-expanded={expanded}>
                    <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl', group.room ? 'bg-primary-soft text-primary' : 'bg-muted text-muted-foreground')}>{group.room ? <DoorOpen className="size-5" /> : <Inbox className="size-5" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[15px] font-semibold">{groupTitle(group)}</span>
                        {group.room && <span className="rounded border border-border bg-muted/60 px-1.5 py-px font-mono text-[11px] font-semibold tracking-wider">{group.room.code}</span>}
                        {group.room && <RoomStatusBadge status={group.room.status} />}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge tone="blue">{group.total} question{group.total === 1 ? '' : 's'}</Badge>
                        {group.mcq > 0 && <span>{group.mcq} MCQ</span>}
                        {group.tf > 0 && <span>· {group.tf} T/F</span>}
                        {group.coding > 0 && <span>· {group.coding} coding</span>}
                        <span>· added {relativeTime(group.lastAdded)}</span>
                        {group.topics.length > 0 && <span className="hidden truncate md:inline">· {group.topics.slice(0, 3).join(', ')}</span>}
                      </span>
                    </span>
                    <ChevronDown className={cn('size-5 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-180')} />
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5 sm:border-l sm:border-border sm:pl-4">
                    <Button variant="outline" size="sm" onClick={() => { setViewing(group); fetchGroup(group.key).catch(err => toast(errorMessage(err), 'error')) }}><Eye />View</Button>
                    <Menu trigger={props => <Button variant="outline" size="sm" loading={downloading === group.key} {...props}><Download />PDF<ChevronDown className="size-3.5 opacity-60" /></Button>}>
                      {close => <>
                        <MenuItem icon={FileText} onClick={() => { close(); download(group, false) }}>Question paper</MenuItem>
                        <MenuItem icon={ListChecks} onClick={() => { close(); download(group, true) }}>Paper with answer key</MenuItem>
                      </>}
                    </Menu>
                    {group.room
                      ? <Link href={`/teacher/rooms/${group.room.id}?tab=questions`} className={buttonVariants({ variant: 'outline', size: 'sm' })}><Pencil />Edit</Link>
                      : <Button variant="outline" size="sm" onClick={() => !expanded && toggle(group.key)}><Pencil />Edit</Button>}
                    <Menu trigger={props => <Button variant="ghost" size="icon-sm" aria-label="More actions" {...props}><MoreHorizontal /></Button>}>
                      {close => <>
                        <MenuItem icon={Plus} onClick={() => { close(); setAdding('ai') }}>Add questions</MenuItem>
                        <MenuItem icon={Trash2} danger onClick={() => { close(); removeGroup(group) }}>Delete all questions</MenuItem>
                      </>}
                    </Menu>
                  </div>
                </div>

                <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                  <div className="overflow-hidden">
                    <div className="border-t border-border">
                      {!list ? <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : !shown?.length ? <p className="py-8 text-center text-sm text-muted-foreground">No questions of this type.</p> : (
                        shown.map((question, index) => (
                          <QuestionCard key={question.id} question={question} index={index}
                            meta={<span className="text-xs text-muted-foreground">· {question.source === 'ai' ? 'AI' : question.source === 'csv' ? 'CSV' : 'Manual'}</span>}
                            actions={<>
                              <QuestionAttachmentButton
                                imageUrl={question.imageUrl}
                                onImageChange={async (url) => {
                                  try {
                                    await api(`/api/questions/${question.id}`, { method: 'PATCH', body: { imageUrl: url } })
                                    toast(url ? 'Image attached.' : 'Image removed.')
                                    refresh(group.key)
                                  } catch (err) {
                                    toast(errorMessage(err), 'error')
                                  }
                                }}
                              />
                              <button onClick={() => setEditing({ group: group.key, question })} aria-label="Edit question" title="Edit" className="rounded p-1.5 text-subtle hover:bg-muted hover:text-foreground"><Pencil className="size-3.5" /></button>
                              <button onClick={() => removeQuestion(group.key, question)} aria-label="Delete question" title="Delete" className="rounded p-1.5 text-subtle hover:bg-muted hover:text-danger"><Trash2 className="size-3.5" /></button>
                            </>} />
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <AddQuestions open={adding !== null} initialMethod={adding ?? 'ai'} onClose={() => setAdding(null)} onSaved={() => refresh('unassigned')} />
      <QuestionEditor open={Boolean(editing)} initial={editing?.question ?? null} onClose={() => setEditing(null)} onSave={save} />
      {viewing && <PaperView open onClose={() => setViewing(null)} meta={metaOf(viewing)} questions={questions[viewing.key] ?? null} />}
    </>
  )
}

export default function QuestionBankPage() {
  return <Suspense><QuestionBank /></Suspense>
}

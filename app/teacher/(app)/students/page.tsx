'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Search, Trash2, Upload, UserCheck, UserPlus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card, EmptyState, PageHeader, Spinner, StatCard } from '@/components/ui/card'
import { Alert, Field, Input, Select, Textarea } from '@/components/ui/form'
import { Dialog, useFeedback } from '@/components/ui/overlay'
import { api, errorMessage, formatDate, type Classroom, type StudentRow } from '@/lib/api'
import { useLatestRequest } from '@/lib/use-latest'

const LIMIT = 50

type Detail = { student: StudentRow; attempts: { id: string; room: string; code: string; status: string; score: number; maxScore: number; submittedAt: string | null; startedAt: string; tabSwitches: number }[] }

function Students() {
  const search = useSearchParams()
  const { toast, confirm } = useFeedback()
  const [rows, setRows] = useState<StudentRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [active, setActive] = useState(0)
  const [domains, setDomains] = useState<string[]>([])
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [unassigned, setUnassigned] = useState(0)
  const [query, setQuery] = useState('')
  const [classroom, setClassroom] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [addOpen, setAddOpen] = useState(search.get('add') === '1')
  const [detail, setDetail] = useState<Detail | null>(null)
  const latest = useLatestRequest()

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
    if (query.trim()) params.set('q', query.trim())
    if (classroom) params.set('classroom', classroom)
    if (status) params.set('status', status)
    return latest(api<{ students: StudentRow[]; total: number; active: number; domains: string[] }>(`/api/students?${params}`), d => { setRows(d.students); setTotal(d.total); setActive(d.active); setDomains(d.domains) })
      .catch(err => toast(errorMessage(err), 'error'))
  }, [page, query, classroom, status, toast, latest])
  const loadClasses = useCallback(() => api<{ classrooms: Classroom[]; unassigned: number }>('/api/classrooms').then(d => { setClassrooms(d.classrooms); setUnassigned(d.unassigned) }).catch(() => {}), [])

  useEffect(() => { const t = window.setTimeout(load, 200); return () => window.clearTimeout(t) }, [load])
  useEffect(() => { loadClasses() }, [loadClasses])

  async function remove(student: StudentRow) {
    if (!(await confirm({ title: `Remove ${student.name || student.email}?`, description: 'They will no longer be able to sign in. Their past exam results are kept.', confirmLabel: 'Remove student', tone: 'danger' }))) return
    setRows(list => list?.filter(s => s.id !== student.id) ?? null)
    setTotal(value => Math.max(0, value - 1))
    setDetail(null)
    try { await api(`/api/students/${student.id}`, { method: 'DELETE' }); toast('Student removed.') } catch (err) { toast(errorMessage(err), 'error') }
    load()
    loadClasses()
  }
  async function open(student: StudentRow) {
    try { setDetail(await api<Detail>(`/api/students/${student.id}`)) } catch (err) { toast(errorMessage(err), 'error') }
  }

  const allTotal = classrooms.reduce((sum, c) => sum + c.students, 0) + unassigned
  const allActive = classrooms.reduce((sum, c) => sum + c.active, 0)
  const pages = Math.max(1, Math.ceil(total / LIMIT))

  return (
    <>
      <PageHeader title="Students" description="The college student list. Students activate their account with an OTP sent to the email you add." actions={<Button onClick={() => setAddOpen(true)}><UserPlus />Add students</Button>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="On the list" value={allTotal} icon={Users} />
        <StatCard label="Activated" value={allActive} icon={UserCheck} tone="green" hint={allTotal ? `${Math.round((allActive / allTotal) * 100)}% of the list` : undefined} />
        <StatCard label="Classes" value={classrooms.length} icon={Users} tone="violet" hint={unassigned ? `${unassigned} yet to choose a class` : undefined} />
      </div>
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" /><Input value={query} onChange={e => { setQuery(e.target.value); setPage(1) }} placeholder="Search name, email, roll number or PRN" className="pl-9" /></div>
          <Select value={classroom} onChange={e => { setClassroom(e.target.value); setPage(1) }} className="md:w-52"><option value="">All classes</option>{classrooms.map(c => <option key={c.id} value={c.id}>{c.label} ({c.students})</option>)}{unassigned > 0 && <option value="none">No class yet ({unassigned})</option>}</Select>
          <Select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }} className="md:w-40"><option value="">Any status</option><option value="active">Activated</option><option value="invited">Not activated</option></Select>
        </div>
        {!rows ? <div className="flex justify-center py-16"><Spinner /></div> : rows.length === 0 ? (
          <EmptyState icon={Users} title="No students found" description={query || classroom || status ? 'Try different filters.' : 'Add students by their college email to get started.'} action={<Button onClick={() => setAddOpen(true)}><UserPlus />Add students</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base min-w-[820px]">
              <thead><tr><th>Student</th><th>Roll no.</th><th>Class</th><th>PRN</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map(s => (
                  <tr key={s.id} className="cursor-pointer" onClick={() => open(s)}>
                    <td><div className="font-medium">{s.name || <span className="text-muted-foreground">Name not set</span>}</div><div className="text-xs text-muted-foreground">{s.email}</div></td>
                    <td className="tabular-nums">{s.rollNumber || '—'}</td>
                    <td>{s.classLabel || <span className="text-muted-foreground">—</span>}</td>
                    <td className="font-mono text-xs text-muted-foreground">{s.prn || '—'}</td>
                    <td>{s.status === 'active' ? <Badge tone="green" dot>Active</Badge> : <Badge tone="amber">Not activated</Badge>}</td>
                    <td className="text-right"><button onClick={e => { e.stopPropagation(); remove(s) }} aria-label={`Remove ${s.email}`} className="rounded p-1.5 text-subtle hover:bg-muted hover:text-danger"><Trash2 className="size-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 text-[13px] text-muted-foreground">
          <span>{total} student{total === 1 ? '' : 's'}{status || classroom || query ? ' match' : ''} · {active} activated</span>
          {pages > 1 && <div className="flex items-center gap-2">
            <Button variant="outline" size="xs" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <span>Page {page} of {pages}</span>
            <Button variant="outline" size="xs" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>}
        </div>
      </Card>

      <AddStudentsDialog open={addOpen} onClose={() => setAddOpen(false)} domains={domains} onAdded={() => { load(); loadClasses() }} />
      <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} size="lg" title={detail?.student.name || detail?.student.email || ''} description={detail?.student.email}
        footer={detail && <Button variant="destructive-outline" onClick={() => remove(detail.student)}><Trash2 />Remove student</Button>}>
        {detail && (
          <div className="flex flex-col gap-5">
            <dl className="grid grid-cols-2 gap-4 text-[13px] sm:grid-cols-4">
              {[['Status', detail.student.status === 'active' ? 'Activated' : 'Not activated'], ['Class', detail.student.classLabel || '—'], ['Roll no.', detail.student.rollNumber || '—'], ['PRN', detail.student.prn || '—'], ['Activated', formatDate(detail.student.activatedAt)], ['Added', formatDate(detail.student.createdAt)]].map(([label, value]) => (
                <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium">{value}</dd></div>
              ))}
            </dl>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Exam history</h3>
              {detail.attempts.length === 0 ? <p className="rounded-md border border-dashed border-border py-6 text-center text-[13px] text-muted-foreground">No exams taken yet.</p> : (
                <div className="overflow-hidden rounded-md border border-border">
                  <table className="table-base">
                    <thead><tr><th>Exam</th><th>Score</th><th>Tabs</th><th>Date</th></tr></thead>
                    <tbody>{detail.attempts.map(a => <tr key={a.id}><td className="font-medium">{a.room}</td><td className="tabular-nums">{a.status === 'submitted' ? `${a.score} / ${a.maxScore}` : <Badge tone="green">Writing</Badge>}</td><td className="tabular-nums">{a.tabSwitches}</td><td className="text-muted-foreground">{formatDate(a.submittedAt ?? a.startedAt)}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </>
  )
}

function AddStudentsDialog({ open, onClose, domains, onAdded }: { open: boolean; onClose: () => void; domains: string[]; onAdded: () => void }) {
  const { toast } = useFeedback()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ added: number; alreadyListed: number; invalid: string[] } | null>(null)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) { setText(''); setResult(null); setError('') } }, [open])
  const count = new Set(text.match(/[^\s,;<>"']+@[^\s,;<>"']+/g) ?? []).size

  async function submit() {
    setSaving(true)
    setError('')
    try {
      const data = await api<{ added: number; alreadyListed: number; invalid: string[] }>('/api/students', { body: { text } })
      setResult(data)
      if (data.added) { toast(`${data.added} student${data.added === 1 ? '' : 's'} added.`); onAdded() }
    } catch (err) { setError(errorMessage(err)) } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Add students" description="Paste college emails, or upload a CSV / text file. Students then activate their own accounts with an OTP."
      footer={result ? <Button onClick={onClose}>Done</Button> : <><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!count || saving}>{saving ? 'Adding…' : `Add ${count || ''} student${count === 1 ? '' : 's'}`}</Button></>}>
      {result ? (
        <div className="flex flex-col gap-3">
          <Alert tone="success">{result.added} added{result.alreadyListed ? ` · ${result.alreadyListed} were already on the list` : ''}.</Alert>
          {result.invalid.length > 0 && <Alert tone="warning"><p className="font-medium">{result.invalid.length} skipped:</p><ul className="mt-1 list-disc pl-5 text-xs">{result.invalid.slice(0, 20).map(item => <li key={item}>{item}</li>)}</ul></Alert>}
          <p className="text-[13px] text-muted-foreground">Tell students to open the examination portal, choose <span className="font-medium text-foreground">Student login → Activate account</span>, and enter their college email.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {error && <Alert>{error}</Alert>}
          <Field label="College emails" hint={domains.length ? `One per line, or separated by commas. Only @${domains.join(', @')} addresses are accepted.` : 'One per line, or separated by commas.'}>
            <Textarea rows={8} className="font-mono text-[13px]" value={text} onChange={e => setText(e.target.value)} placeholder={'sd24_student_one@mgmcen.ac.in\nsd24_student_two@mgmcen.ac.in'} autoFocus />
          </Field>
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}><Upload />Upload CSV / TXT</Button>
            <span className="text-[13px] text-muted-foreground">{count} email{count === 1 ? '' : 's'} detected</span>
            <input ref={fileInput} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; const content = await file.text(); setText(t => `${t}${t ? '\n' : ''}${content}`) }} />
          </div>
        </div>
      )}
    </Dialog>
  )
}

export default function StudentsPage() {
  return <Suspense><Students /></Suspense>
}

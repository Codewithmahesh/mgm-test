'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, Code2, FileDown, FlaskConical, Layers, Lock, MoreHorizontal, Pencil, Plus, Settings, Sparkles, Trash2, Upload } from 'lucide-react'
import { CodeEditor } from '@/components/code-editor'
import { AiDraftDialog, ImportListDialog, LevelPicker, PracticalJobsBanner, type Level } from '@/components/practical-ai'
import { PracticalSubjectDialog } from '@/components/practical-form'
import { QuestionEditor } from '@/components/question-editor'
import { Button } from '@/components/ui/button'
import { Badge, Card, EmptyState, PageHeader, PageLoader, StatCard } from '@/components/ui/card'
import { Alert, Input, Select } from '@/components/ui/form'
import { Dialog, Menu, MenuItem, Tabs, useFeedback } from '@/components/ui/overlay'
import { api, errorMessage, languageLabel, relativeTime, type DraftQuestion } from '@/lib/api'
import { downloadPracticalPdf } from '@/lib/practical-pdf'
import { draftToProblem, problemToDraft, type FacultyExperiment, type PracticalSubject, type Problem, type Progress, type PracticalReport, type ProgressCell, type StudentSubmission } from '@/lib/practical-types'
import { cn } from '@/lib/utils'

type Tab = 'experiments' | 'progress'
/** What the problem editor is currently editing. */
type Editing =
  | { kind: 'experiment'; experiment: FacultyExperiment | null; draft: DraftQuestion | null }
  | { kind: 'practice'; experiment: FacultyExperiment; problem: Problem | null }

export default function PracticalPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { toast, confirm } = useFeedback()
  const [subject, setSubject] = useState<PracticalSubject | null>(null)
  const [experiments, setExperiments] = useState<FacultyExperiment[]>([])
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('experiments')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [importing, setImporting] = useState(false)
  // Bumped when a background job starts, so its banner shows right away.
  const [jobsKey, setJobsKey] = useState(0)
  const [poolFor, setPoolFor] = useState<FacultyExperiment | null>(null)

  const load = useCallback(() => api<{ subject: PracticalSubject; experiments: FacultyExperiment[] }>(`/api/practicals/${id}`)
    .then(d => { setSubject(d.subject); setExperiments(d.experiments); setError('') })
    .catch(err => setError(errorMessage(err))), [id])
  useEffect(() => { void load() }, [load])

  async function saveProblem(q: DraftQuestion) {
    if (!editing) return
    const body = draftToProblem(q)
    if (editing.kind === 'experiment') {
      if (editing.experiment) await api(`/api/practicals/${id}/experiments/${editing.experiment.id}`, { method: 'PATCH', body })
      else await api(`/api/practicals/${id}/experiments`, { body })
      toast(editing.experiment ? 'Experiment saved.' : 'Experiment added.')
    } else {
      const base = `/api/practicals/${id}/experiments/${editing.experiment.id}/practice`
      if (editing.problem) await api(`${base}/${editing.problem.id}`, { method: 'PATCH', body })
      else await api(base, { body })
      toast('Practice problem saved.')
    }
    await load()
  }

  async function move(index: number, by: -1 | 1) {
    const order = experiments.map(e => e.id)
    const [item] = order.splice(index, 1)
    order.splice(index + by, 0, item)
    setExperiments(list => order.map(eid => list.find(e => e.id === eid)!).map((e, i) => ({ ...e, order: i + 1 })))
    try { await api(`/api/practicals/${id}`, { method: 'PATCH', body: { order } }) } catch (err) { toast(errorMessage(err), 'error'); void load() }
  }

  async function removeExperiment(experiment: FacultyExperiment) {
    if (!(await confirm({ title: `Delete experiment ${experiment.order}?`, description: `"${experiment.title}", its practice problems and every student submission for it will be deleted. Later experiments move up one level.`, confirmLabel: 'Delete', tone: 'danger' }))) return
    try { await api(`/api/practicals/${id}/experiments/${experiment.id}`, { method: 'DELETE' }); toast('Experiment deleted.'); await load() } catch (err) { toast(errorMessage(err), 'error') }
  }

  async function removeSubject() {
    if (!subject || !(await confirm({ title: 'Delete this practical?', description: `"${subject.title}" with all its experiments, practice problems and student submissions will be deleted for good.`, confirmLabel: 'Delete practical', tone: 'danger' }))) return
    try { await api(`/api/practicals/${id}`, { method: 'DELETE' }); router.replace('/teacher/practicals') } catch (err) { toast(errorMessage(err), 'error') }
  }

  if (!subject) return error ? <Alert>{error}</Alert> : <PageLoader />

  const editorInitial = editing?.kind === 'experiment' ? (editing.draft ?? (editing.experiment ? problemToDraft(editing.experiment) : null)) : editing?.kind === 'practice' && editing.problem ? problemToDraft(editing.problem) : null

  return (
    <>
      <Link href="/teacher/practicals" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Practicals</Link>
      <PageHeader eyebrow={subject.code || undefined} title={subject.title} description={subject.classLabels.join(' · ')}
        actions={
          <Menu trigger={props => <Button variant="outline" {...props}><Settings />Practical<ChevronDown /></Button>}>
            {close => <>
              <MenuItem icon={Settings} onClick={() => { close(); setSettingsOpen(true) }}>Settings and classes</MenuItem>
              <MenuItem icon={Trash2} danger onClick={() => { close(); void removeSubject() }}>Delete practical</MenuItem>
            </>}
          </Menu>
        } />
      {error && <Alert className="mb-4">{error}</Alert>}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Experiments" value={experiments.length} icon={FlaskConical} tone="violet" />
        <StatCard label="Students" value={subject.students} hint={subject.classLabels.length ? `${subject.classLabels.length} class${subject.classLabels.length === 1 ? '' : 'es'}` : undefined} tone="blue" />
        <StatCard label="Solved overall" value={subject.completionPercent == null ? '—' : `${subject.completionPercent}%`} hint="of every student × experiment" icon={Check} tone="green" />
      </div>

      <Card>
        <Tabs className="px-4" value={tab} onChange={setTab} tabs={[{ value: 'experiments', label: 'Experiments', count: experiments.length }, { value: 'progress', label: 'Student progress' }]} />
        {tab === 'experiments' ? (
          <div className="p-4 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <Button onClick={() => setImporting(true)}><Upload />Import practical list</Button>
              <Button variant="outline" onClick={() => setDrafting(true)}><Sparkles />Write one with AI</Button>
              <Button variant="outline" onClick={() => setEditing({ kind: 'experiment', experiment: null, draft: null })}><Plus />Write it yourself</Button>
            </div>
            <PracticalJobsBanner subjectId={id} refreshKey={jobsKey} onAdded={() => void load()} />
            {experiments.length === 0 ? (
              <EmptyState icon={FlaskConical} title="No experiments yet" description="Import your practical list from a photo, PDF or Word file, or add experiments one by one in the order students should solve them. Each unlocks when every sample test of the one before passes."
                action={<Button onClick={() => setImporting(true)}><Upload />Import practical list</Button>} />
            ) : (
              <ol className="flex flex-col gap-3">
                {experiments.map((experiment, index) => (
                  <li key={experiment.id} className="flex flex-col gap-4 rounded-xl border border-border p-4 sm:flex-row sm:items-start sm:p-5">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-violet-soft text-lg font-semibold tabular-nums text-violet">{experiment.order}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-semibold">{experiment.title}</div>
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{experiment.text}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                        {experiment.topic && <Badge>{experiment.topic}</Badge>}
                        <span>{experiment.samples.length} sample · {experiment.hiddenCount} hidden test{experiment.hiddenCount === 1 ? '' : 's'}</span>
                        <span>·</span>
                        <span>{experiment.poolSize} practice{experiment.aiPracticeCount ? ` + ${experiment.aiPracticeCount} by AI` : ''}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button variant="outline" onClick={() => setEditing({ kind: 'experiment', experiment, draft: null })}><Pencil />Edit</Button>
                      <Button variant="outline" onClick={() => setPoolFor(experiment)}><Layers />Practice</Button>
                      <Menu trigger={props => <Button variant="ghost" size="icon" aria-label="More actions" {...props}><MoreHorizontal /></Button>}>
                        {close => <>
                          <MenuItem icon={ArrowUp} disabled={index === 0} onClick={() => { close(); void move(index, -1) }}>Move up a level</MenuItem>
                          <MenuItem icon={ArrowDown} disabled={index === experiments.length - 1} onClick={() => { close(); void move(index, 1) }}>Move down a level</MenuItem>
                          <MenuItem icon={Trash2} danger onClick={() => { close(); void removeExperiment(experiment) }}>Delete experiment</MenuItem>
                        </>}
                      </Menu>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : <ProgressTab subjectId={id} />}
      </Card>

      <QuestionEditor open={Boolean(editing)} problemOnly initial={editorInitial} onClose={() => setEditing(null)} onSave={saveProblem}
        title={editing?.kind === 'practice' ? (editing.problem ? 'Edit practice problem' : `Practice problem for experiment ${editing.experiment.order}`) : editing?.experiment ? `Edit experiment ${editing.experiment.order}` : 'New experiment'}
        saveLabel={editing?.kind === 'practice' ? 'Save problem' : 'Save experiment'} />
      <AiDraftDialog subjectId={id} experiments={experiments} open={drafting} onClose={() => setDrafting(false)} onDraft={problem => { setDrafting(false); setEditing({ kind: 'experiment', experiment: null, draft: problemToDraft(problem) }) }}
        onBackground={() => { setDrafting(false); setJobsKey(k => k + 1); toast("Writing it in the background. We've emailed you, and will again when it's added.") }} />
      <ImportListDialog subjectId={id} open={importing} onClose={() => setImporting(false)} onAdded={() => { toast('Experiments added.'); void load() }}
        onBackground={() => { setImporting(false); setJobsKey(k => k + 1); toast("Running in the background. We've emailed you, and will again when it's done.") }} />
      <PoolDialog subjectId={id} experiment={poolFor} onClose={() => { setPoolFor(null); void load() }} onEdit={(experiment, problem) => setEditing({ kind: 'practice', experiment, problem })} editing={Boolean(editing)} />
      <PracticalSubjectDialog open={settingsOpen} initial={subject} onClose={() => setSettingsOpen(false)} onSaved={s => { setSubject(s); toast('Practical saved.') }} />
    </>
  )
}

/** The experiment's practice problems: the faculty pool (editable) and the ones the AI wrote for students. */
function PoolDialog({ subjectId, experiment, onClose, onEdit, editing }: { subjectId: string; experiment: FacultyExperiment | null; onClose: () => void; onEdit: (experiment: FacultyExperiment, problem: Problem | null) => void; editing: boolean }) {
  const { toast, confirm } = useFeedback()
  const [data, setData] = useState<{ pool: Problem[]; aiProblems: (Problem & { student: string | null })[] } | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [level, setLevel] = useState<Level>('medium')
  const base = experiment ? `/api/practicals/${subjectId}/experiments/${experiment.id}` : ''
  const load = useCallback(() => { if (base) api<{ pool: Problem[]; aiProblems: (Problem & { student: string | null })[] }>(base).then(setData).catch(err => toast(errorMessage(err), 'error')) }, [base, toast])
  // Reload when the problem editor (opened from here) closes.
  useEffect(() => { if (!editing) load() }, [load, editing])
  useEffect(() => { if (!experiment) setData(null) }, [experiment])

  async function remove(problem: Problem) {
    if (!(await confirm({ title: 'Delete this practice problem?', description: `"${problem.title}" and students' submissions for it will be deleted.`, confirmLabel: 'Delete', tone: 'danger' }))) return
    try { await api(`${base}/practice/${problem.id}`, { method: 'DELETE' }); load() } catch (err) { toast(errorMessage(err), 'error') }
  }

  async function aiDraft() {
    if (!experiment) return
    setDrafting(true)
    try {
      await api(`/api/practicals/${subjectId}/generate`, { body: { mode: 'practice', experiment: experiment.id, level } })
      toast('Practice problem added. Review it before students use it.')
      load()
    } catch (err) { toast(errorMessage(err), 'error') } finally { setDrafting(false) }
  }

  return (
    <Dialog open={Boolean(experiment) && !editing} onClose={onClose} size="xl" title={experiment ? `Practice for experiment ${experiment.order}: ${experiment.title}` : ''}
      description="Students get your practice problems first. Once they've solved them all, they can ask the AI for more on the same topic.">
      {!data ? <PageLoader /> : (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Your practice pool ({data.pool.length})</h3>
              <Button variant="outline" onClick={() => experiment && onEdit(experiment, null)}><Plus />Write one yourself</Button>
            </div>
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4 sm:flex-row sm:items-end">
              <div className="flex-1"><div className="mb-2 text-[13px] font-medium">Add one with AI, at level</div><LevelPicker compact value={level} onChange={setLevel} /></div>
              <Button loading={drafting} onClick={aiDraft}><Sparkles />{drafting ? 'Writing…' : 'Add with AI'}</Button>
            </div>
            {data.pool.length === 0 ? <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">No practice problems yet. Students go straight to AI-written ones.</p> : (
              <ul className="flex flex-col gap-2">
                {data.pool.map(problem => (
                  <li key={problem.id} className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
                    <Code2 className="size-5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{problem.title}</div>
                      <div className="text-xs text-muted-foreground">{problem.samples.length} sample · {problem.hiddenCount} hidden test{problem.hiddenCount === 1 ? '' : 's'}</div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => experiment && onEdit(experiment, problem)}><Pencil />Edit</Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => remove(problem)} aria-label={`Delete ${problem.title}`}><Trash2 /></Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">Written by AI for students ({data.aiProblems.length})</h3>
            {data.aiProblems.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
              <ul className="flex flex-col gap-2">
                {data.aiProblems.map(problem => (
                  <li key={problem.id} className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
                    <Sparkles className="size-5 text-violet" />
                    <span className="min-w-0 flex-1 truncate text-sm">{problem.title}</span>
                    <Button variant="outline" size="sm" onClick={() => experiment && onEdit(experiment, problem)}><Pencil />Edit</Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => remove(problem)} aria-label={`Delete ${problem.title}`}><Trash2 /></Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Dialog>
  )
}

const CELL_STYLE: Record<ProgressCell['status'], string> = {
  solved: 'bg-success-soft text-success ring-success-border',
  attempted: 'bg-warning-soft text-warning ring-warning-border',
  open: 'bg-primary-soft text-primary ring-primary-border',
  locked: 'bg-muted text-subtle ring-border',
}

function Cell({ cell }: { cell: ProgressCell }) {
  const hidden = cell.hiddenTotal ? `hidden ${cell.hiddenPassed}/${cell.hiddenTotal}` : ''
  const title = cell.status === 'solved' ? `Solved ${relativeTime(cell.solvedAt)} · ${cell.attempts} attempt${cell.attempts === 1 ? '' : 's'}${hidden ? ` · ${hidden}` : ''}`
    : cell.status === 'attempted' ? `Not solved yet · ${cell.attempts} attempt${cell.attempts === 1 ? '' : 's'}${hidden ? ` · best ${hidden}` : ''}`
      : cell.status === 'open' ? 'Unlocked, not started' : 'Locked'
  return (
    <div title={`${title}${cell.practiceAttempted ? ` · practice ${cell.practiceSolved}/${cell.practiceAttempted}` : ''}`}
      className={cn('mx-auto flex h-10 w-16 flex-col items-center justify-center rounded-md text-xs font-semibold leading-tight ring-1 ring-inset', CELL_STYLE[cell.status])}>
      {cell.status === 'solved' ? <Check className="size-4" /> : cell.status === 'locked' ? <Lock className="size-3.5" /> : cell.status === 'attempted' ? <span>{cell.attempts}×</span> : <span>open</span>}
      {cell.status === 'solved' && cell.hiddenTotal ? <span className="tabular-nums">{cell.hiddenPassed}/{cell.hiddenTotal}</span> : null}
    </div>
  )
}

/** Students × experiments grid, with a student's submissions one click away. */
function ProgressTab({ subjectId }: { subjectId: string }) {
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [student, setStudent] = useState<Progress['students'][number] | null>(null)
  useEffect(() => { api<Progress>(`/api/practicals/${subjectId}/progress`).then(setProgress).catch(err => setError(errorMessage(err))) }, [subjectId])
  const visible = useMemo(() => (progress?.students ?? []).filter(s => !query || `${s.name} ${s.rollNumber} ${s.classLabel}`.toLowerCase().includes(query.toLowerCase())), [progress, query])

  if (error) return <div className="p-4"><Alert>{error}</Alert></div>
  if (!progress) return <PageLoader />
  if (!progress.experiments.length) return <EmptyState icon={FlaskConical} title="No experiments yet" description="Add experiments to start tracking progress." />
  if (!progress.students.length) return <EmptyState icon={FlaskConical} title="No students yet" description="No activated students in the chosen classes yet." />

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-4 text-[13px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-success" />Solved (hidden x/y)</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-warning" />Tried, not solved</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-primary" />Unlocked</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-border-strong" />Locked</span>
        </div>
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search students" className="sm:w-56" />
      </div>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card">Student</th>
              <th className="text-center">Solved</th>
              {progress.experiments.map(e => <th key={e.id} className="text-center" title={e.title}>E{e.order}<div className="font-normal normal-case text-muted-foreground">{e.solvedBy}/{progress.students.length}</div></th>)}
              <th className="text-center">Practice</th>
              <th>Last active</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(s => (
              <tr key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setStudent(s)}>
                <td className="sticky left-0 z-10 bg-card"><div className="font-medium">{s.name}</div><div className="text-xs text-muted-foreground">{[s.rollNumber && `Roll ${s.rollNumber}`, s.classLabel].filter(Boolean).join(' · ')}</div></td>
                <td className="text-center tabular-nums">{s.solved}/{progress.experiments.length}</td>
                {s.cells.map(cell => <td key={cell.experiment} className="px-1"><Cell cell={cell} /></td>)}
                <td className="text-center tabular-nums">{s.practiceSolved}<span className="text-muted-foreground">/{s.practiceAttempted}</span></td>
                <td className="text-xs text-muted-foreground">{s.lastActivity ? relativeTime(s.lastActivity) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SubmissionsDialog subjectId={subjectId} experiments={progress.experiments} student={student} onClose={() => setStudent(null)} />
    </div>
  )
}

/** One student's submissions in this practical, newest first, with the code, and their practical report as a PDF. */
function SubmissionsDialog({ subjectId, experiments, student, onClose }: { subjectId: string; experiments: Progress['experiments']; student: { id: string; name: string } | null; onClose: () => void }) {
  const { toast } = useFeedback()
  const [submissions, setSubmissions] = useState<StudentSubmission[] | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [reportFor, setReportFor] = useState('all')
  const [exporting, setExporting] = useState(false)

  /** Works for any student and experiment: unsubmitted or failing work still prints, with its status. */
  async function downloadReport() {
    if (!student) return
    setExporting(true)
    try {
      const { report } = await api<{ report: PracticalReport }>(`/api/practicals/${subjectId}/students/${student.id}/report${reportFor === 'all' ? '' : `?experiment=${reportFor}`}`)
      await downloadPracticalPdf(report)
    } catch (err) { toast(errorMessage(err, 'Could not make the PDF.'), 'error') } finally { setExporting(false) }
  }
  useEffect(() => {
    setSubmissions(null)
    setError('')
    if (student) api<{ submissions: StudentSubmission[] }>(`/api/practicals/${subjectId}/students/${student.id}`).then(d => setSubmissions(d.submissions)).catch(err => setError(errorMessage(err)))
  }, [subjectId, student])

  return (
    <Dialog open={Boolean(student)} onClose={onClose} size="xl" title={student?.name ?? ''} description="Every submission in this practical, newest first.">
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
        <span className="text-sm font-medium">Practical report</span>
        <Select value={reportFor} onChange={e => setReportFor(e.target.value)} aria-label="Report for" className="w-64">
          <option value="all">Whole journal (all experiments)</option>
          {experiments.map(e => <option key={e.id} value={e.id}>Experiment {e.order}: {e.title}</option>)}
        </Select>
        <Button variant="outline" size="sm" className="ml-auto" onClick={downloadReport} loading={exporting}><FileDown />{exporting ? 'Preparing PDF…' : 'Download PDF'}</Button>
      </div>
      {error ? <Alert>{error}</Alert> : !submissions ? <PageLoader /> : submissions.length === 0 ? <p className="text-sm text-muted-foreground">No submissions yet.</p> : (
        <ul className="flex flex-col gap-2">
          {submissions.map(s => (
            <li key={s.id} className="rounded-md border border-border">
              <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left">
                <Badge tone={s.solved ? 'green' : s.compileError ? 'red' : 'amber'}>{s.solved ? 'Solved' : s.compileError ? 'Compile error' : 'Not solved'}</Badge>
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  <span className="font-medium">E{s.experiment?.order} · {s.experiment?.title}</span>
                  {s.practice && <span className="text-muted-foreground"> · practice: {s.practice.title}{s.practice.source === 'ai' ? ' (AI)' : ''}</span>}
                </span>
                <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">samples {s.samplesPassed}/{s.samplesTotal}{s.hiddenTotal ? ` · hidden ${s.hiddenPassed}/${s.hiddenTotal}` : ''}</span>
                <span className="text-xs text-muted-foreground">{languageLabel(s.language)} · {relativeTime(s.createdAt)}</span>
                <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open === s.id && 'rotate-180')} />
              </button>
              {open === s.id && (
                <div className="border-t border-border">
                  {s.compileError && <pre className="max-h-32 overflow-auto bg-danger-soft p-2 font-mono text-xs text-danger">{s.compileError}</pre>}
                  <div className="h-72"><CodeEditor value={s.code} language={s.language} readOnly /></div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, CircleX, Code2, Copy, FileDown, Lock, Play, RotateCcw, Send, Sparkles, SquareTerminal, Trophy } from 'lucide-react'
import { CodeEditor } from '@/components/code-editor'
import { LevelPicker, type Level } from '@/components/practical-ai'
import { Button } from '@/components/ui/button'
import { Badge, Card, PageLoader } from '@/components/ui/card'
import { Alert, Select, Textarea } from '@/components/ui/form'
import { Tabs, useFeedback } from '@/components/ui/overlay'
import { api, errorMessage, LANGUAGE_OPTIONS, relativeTime, STARTER_CODE } from '@/lib/api'
import { downloadPracticalPdf } from '@/lib/practical-pdf'
import type { PracticalReport, SolveView, SubmitResult } from '@/lib/practical-types'
import { cn } from '@/lib/utils'

type SampleResult = SubmitResult['sampleResults'][number]
type Panel = 'problem' | 'practice' | 'history'
type ConsoleTab = 'tests' | 'custom'
type CustomRun = { stdout: string; stderr: string; exitCode: number | null; time: string | number | null; compileError: string }

/** Unsent code per problem and language, so a reload doesn't lose work. Browser-only convenience. */
const draftKey = (problemId: string, language: string) => `practical-code:${problemId}:${language}`
function readDraft(problemId: string, language: string) { try { return localStorage.getItem(draftKey(problemId, language)) } catch { return null } }
function writeDraft(problemId: string, language: string, code: string) { try { localStorage.setItem(draftKey(problemId, language), code) } catch { /* storage unavailable */ } }
function clearDraft(problemId: string, language: string) { try { localStorage.removeItem(draftKey(problemId, language)) } catch { /* storage unavailable */ } }

const starterFor = (problem: SolveView['problem'], language: string) => (problem.language === language && problem.starterCode ? problem.starterCode : STARTER_CODE[language] ?? '')

export default function SolveExperimentPage() {
  const { id, expId } = useParams<{ id: string; expId: string }>()
  const problemParam = useSearchParams().get('problem')
  const router = useRouter()
  const { toast, confirm } = useFeedback()
  const [view, setView] = useState<SolveView | null>(null)
  const [error, setError] = useState('')
  const [panel, setPanel] = useState<Panel>('problem')
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>('tests')
  const [language, setLanguage] = useState('cpp')
  const [code, setCode] = useState('')
  const [running, setRunning] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [runResults, setRunResults] = useState<{ results: SampleResult[]; compileError: string } | null>(null)
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [stdin, setStdin] = useState<string | null>(null)
  const [customRunning, setCustomRunning] = useState(false)
  const [customRun, setCustomRun] = useState<CustomRun | null>(null)

  const path = `/api/student/practicals/${id}/experiments/${expId}`
  const load = useCallback(() => api<SolveView>(`${path}${problemParam ? `?problem=${problemParam}` : ''}`).then(data => {
    setView(data)
    setError('')
    const lang = data.lastCode?.language || data.problem.language || 'cpp'
    setLanguage(lang)
    setCode(readDraft(data.problem.id, lang) ?? data.lastCode?.code ?? starterFor(data.problem, lang))
  }).catch(err => setError(errorMessage(err))), [path, problemParam])
  useEffect(() => { setResult(null); setRunResults(null); setCustomRun(null); setStdin(null); setPanel('problem'); void load() }, [load])

  function changeLanguage(next: string) {
    if (!view) return
    setLanguage(next)
    setCode(readDraft(view.problem.id, next) ?? starterFor(view.problem, next))
  }

  function edit(value: string) {
    setCode(value)
    if (view) writeDraft(view.problem.id, language, value)
  }

  async function reset() {
    if (!view) return
    if (!await confirm({ title: 'Reset the code?', description: 'Your code in the editor is replaced with the starter template. Submitted code is kept in "My submissions".', confirmLabel: 'Reset' })) return
    clearDraft(view.problem.id, language)
    setCode(starterFor(view.problem, language))
  }

  /** Runs the code on the sample tests only. Nothing is recorded. */
  async function run() {
    if (!view) return
    setRunning(true)
    setResult(null)
    setConsoleTab('tests')
    try {
      const data = await api<{ testResults?: SampleResult[]; compileError?: string }>('/api/compile', { body: { language, code, testCases: view.problem.samples.map(s => ({ input: s.input, expectedOutput: s.output })) } })
      setRunResults({ results: data.testResults ?? [], compileError: data.compileError ?? '' })
    } catch (err) { toast(errorMessage(err), 'error') } finally { setRunning(false) }
  }

  /** Runs the code once on input the student types. Nothing is recorded. */
  async function runCustom() {
    setCustomRunning(true)
    try {
      const data = await api<{ run?: { stdout?: string; stderr?: string; code?: number | null; time?: string | number | null }; compileError?: string | null }>('/api/compile', { body: { language, code, stdin: stdin ?? '' } })
      setCustomRun({ stdout: data.run?.stdout ?? '', stderr: data.run?.stderr ?? '', exitCode: data.run?.code ?? null, time: data.run?.time ?? null, compileError: data.compileError ?? '' })
    } catch (err) { toast(errorMessage(err), 'error') } finally { setCustomRunning(false) }
  }

  async function submit() {
    if (!view) return
    setSubmitting(true)
    setRunResults(null)
    setConsoleTab('tests')
    try {
      const data = await api<SubmitResult>(`${path}/submit`, { body: { language, code, problem: view.practiceProblem?.id } })
      setResult(data)
      void load()
    } catch (err) { toast(errorMessage(err), 'error') } finally { setSubmitting(false) }
  }

  /** The experiment sheet: the latest submission, or what's in the editor when nothing was submitted. */
  async function downloadPdf() {
    if (!view) return
    setExporting(true)
    try {
      const { report } = await api<{ report: PracticalReport }>(`${path}/report`, { body: { problem: view.practiceProblem?.id, language, code } })
      await downloadPracticalPdf(report)
    } catch (err) { toast(errorMessage(err, 'Could not make the PDF.'), 'error') } finally { setExporting(false) }
  }

  async function moreLikeThis(level: Level) {
    setGenerating(true)
    try {
      const { problem } = await api<{ problem: { id: string } }>(`${path}/practice`, { body: { level } })
      router.push(`/student/practicals/${id}/${expId}?problem=${problem.id}`)
    } catch (err) { toast(errorMessage(err), 'error') } finally { setGenerating(false) }
  }

  if (!view) return error ? <><BackLink id={id} /><Alert>{error}</Alert></> : <PageLoader />
  const { problem } = view
  const shown = result ? { results: result.sampleResults, compileError: result.compileError } : runResults
  const busy = running || submitting
  const locked = view.experiment.status === 'locked'

  return (
    <>
      <BackLink id={id} title={view.subject.title} />
      <div className="mb-5 flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Experiment {view.experiment.order}
            {view.practiceProblem ? <Badge tone={view.practiceProblem.source === 'ai' ? 'violet' : 'blue'}>{view.practiceProblem.source === 'ai' ? 'AI practice' : 'Practice'}</Badge> : view.experiment.status === 'solved' ? <Badge tone="green"><Check className="size-3" />Solved</Badge> : locked && <Badge><Lock className="size-3" />Locked</Badge>}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{problem.title}</h1>
          {view.practiceProblem && <Link href={`/student/practicals/${id}/${expId}`} className="mt-1 inline-block text-sm text-primary hover:underline">Back to the experiment</Link>}
        </div>
        <Button variant="outline" onClick={downloadPdf} loading={exporting}><FileDown />{exporting ? 'Preparing PDF…' : 'Download PDF'}</Button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Problem, practice and history, one at a time */}
        <Card className="flex min-h-0 flex-col overflow-hidden xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]">
          <Tabs className="shrink-0 px-4" value={panel} onChange={setPanel}
            tabs={locked ? [{ value: 'problem', label: 'Problem' }] : [{ value: 'problem', label: 'Problem' }, { value: 'practice', label: 'Practice more', count: view.practice.length }, { value: 'history', label: 'My submissions', count: view.history.length }]} />
          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            {panel === 'problem' ? (
              <div className="flex flex-col gap-6">
                <p className="whitespace-pre-wrap text-[15px] leading-7">{problem.text}</p>
                {problem.inputFormat && <Section label="Input">{problem.inputFormat}</Section>}
                {problem.outputFormat && <Section label="Output">{problem.outputFormat}</Section>}
                {problem.constraints && <Section label="Constraints"><span className="font-mono text-[13px] leading-6">{problem.constraints}</span></Section>}
                {problem.samples.map((sample, i) => (
                  <div key={i} className="overflow-hidden rounded-lg border border-border">
                    <div className="border-b border-border bg-muted/50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Example {i + 1}</div>
                    <div className="flex flex-col divide-y divide-border">
                      <IoBlock label="Input" text={sample.input} copy />
                      <IoBlock label="Output" text={sample.output} copy />
                    </div>
                    {sample.explanation && <p className="whitespace-pre-wrap border-t border-border px-3 py-2.5 text-sm leading-6 text-muted-foreground">{sample.explanation}</p>}
                  </div>
                ))}
                <p className="rounded-lg bg-primary-soft/60 p-3 text-sm leading-6 text-primary">
                  {view.practiceProblem ? 'Pass every example to solve this practice problem.' : 'Pass every example to solve this experiment and unlock the next one.'}
                  {problem.hiddenCount > 0 && ` Your code is also checked on ${problem.hiddenCount} hidden test${problem.hiddenCount === 1 ? '' : 's'}; your faculty sees that score.`}
                </p>
              </div>
            ) : panel === 'practice' ? (
              <PracticePanel view={view} subjectId={id} generating={generating} onGenerate={moreLikeThis} />
            ) : view.history.length === 0 ? <p className="text-sm text-muted-foreground">No submissions yet.</p> : (
              <ul className="flex flex-col divide-y divide-border">
                {view.history.map(h => (
                  <li key={h.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                    <Badge tone={h.solved ? 'green' : h.compileError ? 'red' : 'amber'}>{h.solved ? 'Solved' : h.compileError ? 'Compile error' : 'Not solved'}</Badge>
                    <span className="tabular-nums text-muted-foreground">examples {h.samplesPassed}/{h.samplesTotal}{h.hiddenTotal ? ` · hidden ${h.hiddenPassed}/${h.hiddenTotal}` : ''}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{relativeTime(h.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* Editor, console and results; a locked experiment can be read, not solved */}
        {locked ? <LockedNotice subjectId={id} order={view.experiment.order} /> : (
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
              <Select value={language} onChange={e => changeLanguage(e.target.value)} aria-label="Language" className="w-44">
                {LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
              <Button variant="ghost" size="icon-sm" onClick={reset} title="Reset to the starter code" aria-label="Reset to the starter code"><RotateCcw /></Button>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" onClick={run} loading={running} disabled={submitting}><Play />Run examples</Button>
                <Button onClick={submit} loading={submitting} disabled={running}><Send />Submit</Button>
              </div>
            </div>
            <div className="h-[58vh] min-h-[400px]"><CodeEditor value={code} onChange={edit} language={language} /></div>
          </Card>

          {result && <ResultBanner result={result} subjectId={id} practice={Boolean(view.practiceProblem)} />}

          <Card className="overflow-hidden">
            <Tabs className="px-3" value={consoleTab} onChange={tab => { setConsoleTab(tab); if (tab === 'custom' && stdin === null) setStdin(problem.samples[0]?.input ?? '') }}
              tabs={[{ value: 'tests', label: 'Test results' }, { value: 'custom', label: 'Custom input' }]} />
            <div className="p-4">
              {consoleTab === 'tests' ? (
                busy ? <ConsoleNote>{submitting ? 'Submitting and grading your code…' : 'Running your code on the examples…'}</ConsoleNote>
                  : !shown ? <ConsoleNote>Run your code to see its output on each example here. Nothing is recorded until you submit.</ConsoleNote>
                    : <TestResults shown={shown} submitted={Boolean(result)} />
              ) : (
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-subtle">Input (stdin)</span>
                    <Textarea value={stdin ?? ''} onChange={e => setStdin(e.target.value)} spellCheck={false} className="min-h-28 font-mono text-[13px] leading-5" placeholder="Type the input your program reads" />
                  </label>
                  <div className="flex items-center gap-3">
                    <Button variant="outline" onClick={runCustom} loading={customRunning} disabled={busy}><SquareTerminal />Run with this input</Button>
                    <span className="text-xs text-muted-foreground">Not recorded or graded.</span>
                  </div>
                  {customRun && <CustomOutput run={customRun} />}
                </div>
              )}
            </div>
          </Card>
        </div>
        )}
      </div>
    </>
  )
}

/** In place of the editor: why it can't be solved yet, and the way to the experiment that unlocks it. */
function LockedNotice({ subjectId, order }: { subjectId: string; order: number }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-4 p-8 text-center xl:min-h-[420px]">
      <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"><Lock className="size-6" /></span>
      <div>
        <div className="text-lg font-semibold">This experiment is locked</div>
        <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
          You can read the aim and the examples now. It opens for coding once you solve experiment {order - 1} by passing all of its sample tests.
        </p>
      </div>
      <Link href={`/student/practicals/${subjectId}`}><Button variant="outline"><ArrowLeft />Back to the experiments</Button></Link>
    </Card>
  )
}

function BackLink({ id, title }: { id: string; title?: string }) {
  return <Link href={`/student/practicals/${id}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{title ?? 'Back'}</Link>
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle">{label}</div><div className="whitespace-pre-wrap text-[15px] leading-7">{children}</div></div>
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
  }
  return (
    <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
      {copied ? <><Check className="size-3" />Copied</> : <><Copy className="size-3" />Copy</>}
    </button>
  )
}

/** A labelled block of program input or output, shown exactly (line breaks and spacing kept). */
function IoBlock({ label, text, copy, tone }: { label: string; text: string; copy?: boolean; tone?: 'good' | 'bad' }) {
  return (
    <div className={cn('px-3 py-2.5', tone === 'bad' && 'bg-danger-soft/40', tone === 'good' && 'bg-success-soft/30')}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{label}</span>
        {copy && <CopyButton text={text} />}
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre font-mono text-[13px] leading-5">{text || <span className="italic text-subtle">(empty)</span>}</pre>
    </div>
  )
}

function ConsoleNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>
}

/** Each example's verdict; failed ones open with the input, the expected output and the program's output. */
function TestResults({ shown, submitted }: { shown: { results: SampleResult[]; compileError: string }; submitted: boolean }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set(shown.results.filter(r => !r.passed).map(r => r.testCase)))
  useEffect(() => { setOpen(new Set(shown.results.filter(r => !r.passed).map(r => r.testCase))) }, [shown])

  if (shown.compileError) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-danger"><CircleX className="size-4" />Compilation error</div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-danger-soft p-3 font-mono text-[13px] leading-5 text-danger">{shown.compileError}</pre>
      </div>
    )
  }
  const passed = shown.results.filter(r => r.passed).length
  const all = shown.results.length > 0 && passed === shown.results.length
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn('text-sm font-semibold', all ? 'text-success' : 'text-warning')}>{passed}/{shown.results.length} examples passed</span>
        <div className="flex gap-1">{shown.results.map(r => <span key={r.testCase} className={cn('h-1.5 w-6 rounded-full', r.passed ? 'bg-success' : 'bg-danger')} />)}</div>
        <span className="ml-auto text-xs text-muted-foreground">{submitted ? 'Submitted' : 'Run only, not submitted'}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {shown.results.map(r => {
          const isOpen = open.has(r.testCase)
          return (
            <li key={r.testCase} className={cn('overflow-hidden rounded-lg border', r.passed ? 'border-success-border' : 'border-danger-border')}>
              <button type="button" onClick={() => setOpen(prev => { const next = new Set(prev); if (next.has(r.testCase)) next.delete(r.testCase); else next.add(r.testCase); return next })}
                className={cn('flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold', r.passed ? 'bg-success-soft/40' : 'bg-danger-soft/40')} aria-expanded={isOpen}>
                {r.passed ? <CheckCircle2 className="size-4 text-success" /> : <CircleX className="size-4 text-danger" />}
                Example {r.testCase}: {r.passed ? 'passed' : 'wrong output'}
                <ChevronDown className={cn('ml-auto size-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
              </button>
              {isOpen && (
                <div className="flex flex-col divide-y divide-border border-t border-border">
                  <IoBlock label="Input" text={r.input} />
                  <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                    <IoBlock label="Expected output" text={r.expected} />
                    <IoBlock label="Your output" text={r.actual} tone={r.passed ? 'good' : 'bad'} />
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function CustomOutput({ run }: { run: CustomRun }) {
  if (run.compileError) return <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-danger-soft p-3 font-mono text-[13px] leading-5 text-danger">{run.compileError}</pre>
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-3 border-b border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold uppercase tracking-wide">Output</span>
        {run.exitCode !== null && <span className={cn('tabular-nums', run.exitCode !== 0 && 'text-danger')}>exit code {run.exitCode}</span>}
        {run.time != null && run.time !== '' && <span className="tabular-nums">{typeof run.time === 'number' ? `${run.time} ms` : run.time}</span>}
        <span className="ml-auto"><CopyButton text={run.stdout} /></span>
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre px-3 py-2.5 font-mono text-[13px] leading-5">{run.stdout || <span className="italic text-subtle">(no output)</span>}</pre>
      {run.stderr && <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-border bg-danger-soft/40 px-3 py-2.5 font-mono text-[13px] leading-5 text-danger">{run.stderr}</pre>}
    </div>
  )
}

function ResultBanner({ result, subjectId, practice }: { result: SubmitResult; subjectId: string; practice: boolean }) {
  const hidden = result.hiddenTotal ? ` Hidden tests: ${result.hiddenPassed}/${result.hiddenTotal}.` : ''
  if (!result.solved) {
    return <Alert tone="warning">{result.compileError ? 'Your code did not compile. Fix the error and submit again.' : `${result.samplesPassed}/${result.samplesTotal} examples passed. Pass all of them to solve it.${hidden}`}</Alert>
  }
  return (
    <Card className="flex flex-col gap-4 border-success-border bg-success-soft/40 p-5 sm:flex-row sm:items-center">
      <Trophy className="size-9 shrink-0 text-success" />
      <div className="flex-1 text-sm">
        <div className="text-base font-semibold text-success">{practice ? 'Practice problem solved!' : 'Experiment solved!'}</div>
        <div className="text-muted-foreground">All {result.samplesTotal} examples passed.{hidden}{!practice && result.unlocked ? ` Experiment ${result.unlocked.order} is now unlocked.` : ''}</div>
      </div>
      {!practice && result.unlocked && <Link href={`/student/practicals/${subjectId}/${result.unlocked.id}`}><Button size="lg">Next experiment<ArrowRight /></Button></Link>}
    </Card>
  )
}

/** Practice problems on the same topic: the faculty's pool first, then "More like this" from the AI at a chosen level. */
function PracticePanel({ view, subjectId, generating, onGenerate }: { view: SolveView; subjectId: string; generating: boolean; onGenerate: (level: Level) => void }) {
  const [level, setLevel] = useState<Level>('medium')
  const base = `/student/practicals/${subjectId}/${view.experiment.id}`
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm leading-6 text-muted-foreground">Extra problems on the same topic as this experiment. Your faculty sees what you solve here.</p>
      {view.practice.length > 0 && (
        <ul className="flex flex-col gap-2">
          {view.practice.map(p => (
            <li key={p.id}>
              <Link href={`${base}?problem=${p.id}`} className={cn('flex items-center gap-3 rounded-lg border px-4 py-3 text-sm hover:bg-muted', view.practiceProblem?.id === p.id ? 'border-primary bg-primary-soft/40' : 'border-border')}>
                {p.source === 'ai' ? <Sparkles className="size-5 text-violet" /> : <Code2 className="size-5 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
                {p.solved ? <Badge tone="green"><Check className="size-3" />Solved</Badge> : p.attempts ? <span className="text-xs text-warning">{p.attempts} tries</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {view.canGenerate ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4">
          <div className="text-sm font-semibold">More like this, written by AI</div>
          <LevelPicker value={level} onChange={setLevel} compact />
          <Button onClick={() => onGenerate(level)} loading={generating}><Sparkles />{generating ? 'Writing a problem…' : 'Give me a problem'}</Button>
        </div>
      ) : <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Solve your faculty&apos;s practice problems above to unlock AI-written ones.</p>}
    </div>
  )
}

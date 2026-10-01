'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, CircleX, Code2, Play, Send, Sparkles, Trophy } from 'lucide-react'
import { CodeEditor } from '@/components/code-editor'
import { LevelPicker, type Level } from '@/components/practical-ai'
import { Button } from '@/components/ui/button'
import { Badge, Card, PageLoader } from '@/components/ui/card'
import { Alert, Select } from '@/components/ui/form'
import { Tabs, useFeedback } from '@/components/ui/overlay'
import { api, errorMessage, LANGUAGE_OPTIONS, relativeTime, STARTER_CODE } from '@/lib/api'
import type { SolveView, SubmitResult } from '@/lib/practical-types'
import { cn } from '@/lib/utils'

type SampleResult = SubmitResult['sampleResults'][number]
type Panel = 'problem' | 'practice' | 'history'

/** Unsent code per problem and language, so a reload doesn't lose work. Browser-only convenience. */
const draftKey = (problemId: string, language: string) => `practical-code:${problemId}:${language}`
function readDraft(problemId: string, language: string) { try { return localStorage.getItem(draftKey(problemId, language)) } catch { return null } }
function writeDraft(problemId: string, language: string, code: string) { try { localStorage.setItem(draftKey(problemId, language), code) } catch { /* storage unavailable */ } }

export default function SolveExperimentPage() {
  const { id, expId } = useParams<{ id: string; expId: string }>()
  const problemParam = useSearchParams().get('problem')
  const router = useRouter()
  const { toast } = useFeedback()
  const [view, setView] = useState<SolveView | null>(null)
  const [error, setError] = useState('')
  const [panel, setPanel] = useState<Panel>('problem')
  const [language, setLanguage] = useState('cpp')
  const [code, setCode] = useState('')
  const [running, setRunning] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [runResults, setRunResults] = useState<{ results: SampleResult[]; compileError: string } | null>(null)
  const [result, setResult] = useState<SubmitResult | null>(null)

  const path = `/api/student/practicals/${id}/experiments/${expId}`
  const load = useCallback(() => api<SolveView>(`${path}${problemParam ? `?problem=${problemParam}` : ''}`).then(data => {
    setView(data)
    setError('')
    const lang = data.lastCode?.language || data.problem.language || 'cpp'
    setLanguage(lang)
    setCode(readDraft(data.problem.id, lang) ?? data.lastCode?.code ?? (data.problem.language === lang && data.problem.starterCode ? data.problem.starterCode : STARTER_CODE[lang] ?? ''))
  }).catch(err => setError(errorMessage(err))), [path, problemParam])
  useEffect(() => { setResult(null); setRunResults(null); setPanel('problem'); void load() }, [load])

  function changeLanguage(next: string) {
    if (!view) return
    setLanguage(next)
    setCode(readDraft(view.problem.id, next) ?? (view.problem.language === next && view.problem.starterCode ? view.problem.starterCode : STARTER_CODE[next] ?? ''))
  }

  function edit(value: string) {
    setCode(value)
    if (view) writeDraft(view.problem.id, language, value)
  }

  /** Runs the code on the sample tests only. Nothing is recorded. */
  async function run() {
    if (!view) return
    setRunning(true)
    setResult(null)
    try {
      const data = await api<{ testResults?: SampleResult[]; compileError?: string }>('/api/compile', { body: { language, code, testCases: view.problem.samples.map(s => ({ input: s.input, expectedOutput: s.output })) } })
      setRunResults({ results: data.testResults ?? [], compileError: data.compileError ?? '' })
    } catch (err) { toast(errorMessage(err), 'error') } finally { setRunning(false) }
  }

  async function submit() {
    if (!view) return
    setSubmitting(true)
    setRunResults(null)
    try {
      const data = await api<SubmitResult>(`${path}/submit`, { body: { language, code, problem: view.practiceProblem?.id } })
      setResult(data)
      void load()
    } catch (err) { toast(errorMessage(err), 'error') } finally { setSubmitting(false) }
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

  return (
    <>
      <BackLink id={id} title={view.subject.title} />
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{problem.title}</h1>
        <Badge tone="violet">Experiment {view.experiment.order}</Badge>
        {view.practiceProblem ? <Badge tone={view.practiceProblem.source === 'ai' ? 'violet' : 'blue'}>{view.practiceProblem.source === 'ai' ? 'AI practice' : 'Practice'}</Badge> : view.experiment.status === 'solved' && <Badge tone="green"><Check className="size-3" />Solved</Badge>}
        {view.practiceProblem && <Link href={`/student/practicals/${id}/${expId}`} className="text-sm text-primary hover:underline">Back to the experiment</Link>}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Problem, practice and history, one at a time */}
        <Card className="flex min-h-0 flex-col overflow-hidden xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]">
          <Tabs className="shrink-0 px-4" value={panel} onChange={setPanel}
            tabs={[{ value: 'problem', label: 'Problem' }, { value: 'practice', label: 'Practice more', count: view.practice.length }, { value: 'history', label: 'My submissions', count: view.history.length }]} />
          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            {panel === 'problem' ? (
              <div className="flex flex-col gap-5">
                <p className="whitespace-pre-wrap text-[15px] leading-7">{problem.text}</p>
                {problem.inputFormat && <Section label="Input">{problem.inputFormat}</Section>}
                {problem.outputFormat && <Section label="Output">{problem.outputFormat}</Section>}
                {problem.constraints && <Section label="Constraints"><span className="font-mono text-sm">{problem.constraints}</span></Section>}
                {problem.samples.map((sample, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-subtle">Example {i + 1}</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[13px] leading-5"><span className="mb-1 block font-sans text-[11px] font-semibold uppercase text-subtle">Input</span>{sample.input}</pre>
                      <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[13px] leading-5"><span className="mb-1 block font-sans text-[11px] font-semibold uppercase text-subtle">Output</span>{sample.output}</pre>
                    </div>
                    {sample.explanation && <p className="text-sm text-muted-foreground">{sample.explanation}</p>}
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

        {/* Editor and results */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
              <Select value={language} onChange={e => changeLanguage(e.target.value)} aria-label="Language" className="w-48">
                {LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" size="lg" onClick={run} loading={running} disabled={submitting}><Play />Run examples</Button>
                <Button size="lg" onClick={submit} loading={submitting} disabled={running}><Send />Submit</Button>
              </div>
            </div>
            <div className="h-[62vh] min-h-[420px]"><CodeEditor value={code} onChange={edit} language={language} /></div>
          </Card>

          {result && <ResultBanner result={result} subjectId={id} practice={Boolean(view.practiceProblem)} />}
          {shown && (
            <Card className="p-5">
              <div className="mb-3 text-sm font-semibold">{result ? 'Examples' : 'Run on the examples'} <span className="font-normal text-muted-foreground">{result ? '' : '(not submitted)'}</span></div>
              {shown.compileError ? <pre className="max-h-56 overflow-auto rounded-lg bg-danger-soft p-3 font-mono text-[13px] text-danger">{shown.compileError}</pre> : (
                <ul className="flex flex-col gap-3">
                  {shown.results.map(r => (
                    <li key={r.testCase} className={cn('rounded-lg border p-3 text-sm', r.passed ? 'border-success-border bg-success-soft/40' : 'border-danger-border bg-danger-soft/40')}>
                      <div className="flex items-center gap-2 font-semibold">{r.passed ? <CheckCircle2 className="size-4 text-success" /> : <CircleX className="size-4 text-danger" />}Example {r.testCase}: {r.passed ? 'passed' : 'failed'}</div>
                      {!r.passed && (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <pre className="overflow-x-auto rounded-md bg-card p-2.5 font-mono text-[13px]"><span className="mb-1 block font-sans text-[11px] font-semibold uppercase text-subtle">Expected</span>{r.expected}</pre>
                          <pre className="overflow-x-auto rounded-md bg-card p-2.5 font-mono text-[13px]"><span className="mb-1 block font-sans text-[11px] font-semibold uppercase text-subtle">Your output</span>{r.actual}</pre>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  )
}

function BackLink({ id, title }: { id: string; title?: string }) {
  return <Link href={`/student/practicals/${id}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{title ?? 'Back'}</Link>
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle">{label}</div><div className="whitespace-pre-wrap text-[15px] leading-7">{children}</div></div>
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

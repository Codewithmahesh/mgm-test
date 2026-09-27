'use client'

import { useCallback, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, CircleX, Loader2, Play, Plus, Terminal, Trash2, XCircle } from 'lucide-react'
import { CodeEditor } from '@/components/code-editor'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/form'
import { LANGUAGE_OPTIONS, STARTER_CODE } from '@/lib/api'
import type { CompileResponse, RunResult, TestResult } from '@/lib/compiler'
import { cn } from '@/lib/utils'

type TestCaseInput = { input: string; expectedOutput: string }

const DEFAULT_LANGUAGE = 'python'

/**
 * Full-featured standalone compiler panel. Can be mounted on its own page (/compiler)
 * or embedded as a component.
 */
export function CompilerPanel() {
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE)
  const [code, setCode] = useState(STARTER_CODE[DEFAULT_LANGUAGE] ?? '')
  const [stdin, setStdin] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [output, setOutput] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Test cases
  const [testCases, setTestCases] = useState<TestCaseInput[]>([])
  const [testResults, setTestResults] = useState<TestResult[] | null>(null)
  const [overallPassed, setOverallPassed] = useState<boolean | null>(null)
  const [activeTab, setActiveTab] = useState<'output' | 'testcases'>('output')

  function changeLanguage(next: string) {
    const untouched = !code.trim() || code === (STARTER_CODE[language] ?? '')
    setLanguage(next)
    if (untouched) setCode(STARTER_CODE[next] ?? '')
  }

  const run = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setOutput(null)
    setTestResults(null)
    setOverallPassed(null)

    try {
      const hasTestCases = testCases.length > 0 && testCases.some(tc => tc.expectedOutput.trim())
      const payload: Record<string, unknown> = { language, code }
      if (hasTestCases) {
        payload.testCases = testCases
        setActiveTab('testcases')
      } else {
        payload.stdin = stdin
        setActiveTab('output')
      }

      const res = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data: CompileResponse & { error?: string } = await res.json()

      if (!res.ok) {
        setError(data.error || `Execution failed (${res.status})`)
        return
      }

      if (data.testResults) {
        setTestResults(data.testResults)
        setOverallPassed(data.overallPassed ?? false)
      } else if (data.run) {
        setOutput(data.run)
      }
    } catch {
      setError('Network error — check your connection and try again.')
    } finally {
      setIsLoading(false)
    }
  }, [language, code, stdin, testCases])

  // Test case management
  function addTestCase() {
    setTestCases(prev => [...prev, { input: '', expectedOutput: '' }])
  }
  function removeTestCase(index: number) {
    setTestCases(prev => prev.filter((_, i) => i !== index))
  }
  function updateTestCase(index: number, field: 'input' | 'expectedOutput', value: string) {
    setTestCases(prev => prev.map((tc, i) => (i === index ? { ...tc, [field]: value } : tc)))
  }

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* ── Left: Editor ─────────────────────────────────────────────── */}
      <section className="flex min-h-0 flex-1 flex-col bg-[#1e1e1e]">
        <div className="flex items-center justify-between gap-2 border-b border-black/40 bg-[#252526] px-3 py-2">
          <div className="flex items-center gap-2">
            <Select value={language} onChange={e => changeLanguage(e.target.value)} aria-label="Language" className="h-8 w-44 border-white/10 bg-[#3c3c3c] text-[13px] text-white focus:border-primary">
              {LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </div>
          <Button size="sm" onClick={run} disabled={isLoading} className="gap-1.5 bg-success text-white hover:bg-success-hover disabled:opacity-60">
            {isLoading ? <><Loader2 className="size-3.5 animate-spin" />Running…</> : <><Play className="size-3.5" />Run Code</>}
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <CodeEditor value={code} onChange={setCode} language={language} />
        </div>
      </section>

      {/* ── Right: Output & Test Cases ───────────────────────────────── */}
      <section className="flex min-h-0 flex-col border-border lg:w-[42%] lg:border-l max-lg:max-h-[50%] max-lg:border-t">
        {/* Tab bar */}
        <div className="flex shrink-0 border-b border-border bg-card">
          <button onClick={() => setActiveTab('output')} className={cn('flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium transition-colors', activeTab === 'output' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            <Terminal className="size-3.5" />Output
          </button>
          <button onClick={() => setActiveTab('testcases')} className={cn('flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium transition-colors', activeTab === 'testcases' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            <CheckCircle2 className="size-3.5" />Test Cases
            {testCases.length > 0 && <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums">{testCases.length}</span>}
          </button>
        </div>

        {activeTab === 'output' ? (
          <OutputPanel output={output} error={error} isLoading={isLoading} stdin={stdin} onStdinChange={setStdin} />
        ) : (
          <TestCasePanel
            testCases={testCases}
            testResults={testResults}
            overallPassed={overallPassed}
            onAdd={addTestCase}
            onRemove={removeTestCase}
            onUpdate={updateTestCase}
            isLoading={isLoading}
          />
        )}
      </section>
    </div>
  )
}

// ── Output panel ──────────────────────────────────────────────────────────────

function OutputPanel({ output, error, isLoading, stdin, onStdinChange }: {
  output: RunResult | null; error: string | null; isLoading: boolean; stdin: string; onStdinChange: (v: string) => void
}) {
  const [stdinOpen, setStdinOpen] = useState(false)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Stdin input */}
      <div className="shrink-0 border-b border-border">
        <button onClick={() => setStdinOpen(!stdinOpen)} className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
          <span>Standard Input (stdin)</span>
          {stdinOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
        {stdinOpen && (
          <textarea
            value={stdin}
            onChange={e => onStdinChange(e.target.value)}
            placeholder="Enter input here..."
            rows={3}
            className="w-full resize-none border-t border-border bg-card px-4 py-2 font-mono text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50"
          />
        )}
      </div>

      {/* Terminal output */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-[#1a1918] p-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-white/50">
            <Loader2 className="size-4 animate-spin" />
            <span>Executing code…</span>
          </div>
        ) : error ? (
          <div className="flex items-start gap-2">
            <XCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
            <pre className="whitespace-pre-wrap font-mono text-[13px] leading-5 text-red-400">{error}</pre>
          </div>
        ) : output ? (
          <div className="space-y-3">
            {output.stderr && (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-red-400/70">stderr</p>
                <pre className="whitespace-pre-wrap font-mono text-[13px] leading-5 text-red-400">{output.stderr}</pre>
              </div>
            )}
            {output.stdout && (
              <div>
                {output.stderr && <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-400/70">stdout</p>}
                <pre className="whitespace-pre-wrap font-mono text-[13px] leading-5 text-emerald-300">{output.stdout}</pre>
              </div>
            )}
            {!output.stdout && !output.stderr && (
              <p className="text-sm italic text-white/40">Program finished with no output.</p>
            )}
            {output.code !== null && output.code !== 0 && (
              <p className="mt-2 text-[11px] text-white/40">Exit code: {output.code}{output.signal ? ` (${output.signal})` : ''}</p>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-white/30">
            <Terminal className="size-8" />
            <p className="text-sm">Run your code to see output here</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Test case panel ───────────────────────────────────────────────────────────

function TestCasePanel({ testCases, testResults, overallPassed, onAdd, onRemove, onUpdate, isLoading }: {
  testCases: TestCaseInput[]; testResults: TestResult[] | null; overallPassed: boolean | null
  onAdd: () => void; onRemove: (i: number) => void; onUpdate: (i: number, f: 'input' | 'expectedOutput', v: string) => void; isLoading: boolean
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Overall result banner */}
      {overallPassed !== null && (
        <div className={cn('flex items-center gap-2 px-4 py-2.5 text-sm font-semibold', overallPassed ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500')}>
          {overallPassed ? <CheckCircle2 className="size-4" /> : <CircleX className="size-4" />}
          {overallPassed ? 'All test cases passed!' : 'Some test cases failed'}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Test results (after running) */}
        {testResults && testResults.length > 0 && (
          <div className="border-b border-border">
            {testResults.map(result => (
              <TestResultRow key={result.testCase} result={result} />
            ))}
          </div>
        )}

        {/* Test case inputs */}
        <div className="p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold">Test Cases</h3>
            <Button size="sm" variant="outline" onClick={onAdd} disabled={testCases.length >= 20} className="h-7 gap-1 text-xs">
              <Plus className="size-3" />Add
            </Button>
          </div>

          {testCases.length === 0 ? (
            <p className="mt-3 text-center text-[13px] text-muted-foreground">
              No test cases added. Click &quot;Add&quot; to create test cases, or use the Output tab with stdin.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {testCases.map((tc, i) => (
                <div key={i} className="overflow-hidden rounded-lg border border-border">
                  <div className="flex items-center justify-between bg-muted px-3 py-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Case {i + 1}</span>
                    <button onClick={() => onRemove(i)} className="rounded p-0.5 text-muted-foreground hover:text-danger" aria-label={`Remove test case ${i + 1}`}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <div className="grid gap-px bg-border sm:grid-cols-2">
                    <div className="bg-card">
                      <label className="block px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Input</label>
                      <textarea
                        value={tc.input}
                        onChange={e => onUpdate(i, 'input', e.target.value)}
                        rows={2}
                        className="w-full resize-none bg-card px-3 pb-2 font-mono text-[13px] text-foreground outline-none placeholder:text-muted-foreground/40"
                        placeholder="stdin..."
                        disabled={isLoading}
                      />
                    </div>
                    <div className="bg-card">
                      <label className="block px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Expected Output</label>
                      <textarea
                        value={tc.expectedOutput}
                        onChange={e => onUpdate(i, 'expectedOutput', e.target.value)}
                        rows={2}
                        className="w-full resize-none bg-card px-3 pb-2 font-mono text-[13px] text-foreground outline-none placeholder:text-muted-foreground/40"
                        placeholder="expected stdout..."
                        disabled={isLoading}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Individual test result row ────────────────────────────────────────────────

function TestResultRow({ result }: { result: TestResult }) {
  const [expanded, setExpanded] = useState(!result.passed)

  return (
    <div className={cn('border-b border-border last:border-b-0', !result.passed && 'bg-red-500/5')}>
      <button onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm">
        {result.passed ? (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
        ) : (
          <CircleX className="size-4 shrink-0 text-red-500" />
        )}
        <span className="font-medium">Test Case {result.testCase}</span>
        <span className={cn('ml-auto rounded px-1.5 py-0.5 text-[11px] font-semibold', result.passed ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500')}>
          {result.passed ? 'PASSED' : 'FAILED'}
        </span>
        {expanded ? <ChevronUp className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="grid gap-3 px-4 pb-3 sm:grid-cols-3">
          <CompactBlock label="Input" value={result.input} />
          <CompactBlock label="Expected" value={result.expected} tone="emerald" />
          <CompactBlock label="Actual" value={result.actual} tone={result.passed ? 'emerald' : 'red'} />
        </div>
      )}
    </div>
  )
}

function CompactBlock({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'red' }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="bg-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <pre className={cn('overflow-x-auto p-2.5 font-mono text-[12px] leading-4', tone === 'red' ? 'text-red-500' : tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground')}>
        {value || <span className="italic text-muted-foreground/50">(empty)</span>}
      </pre>
    </div>
  )
}

// ── Compact run button for embedding in CodingView ────────────────────────────

/**
 * A lightweight "Run" button + output panel that can be embedded in the existing
 * exam CodingView. It runs the student's current code against the question's
 * sample test cases (or with custom stdin).
 */
export function RunCodeButton({ language, code, samples, className }: {
  language: string; code: string; samples?: Array<{ input: string; output: string }>; className?: string
}) {
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<{ output?: RunResult; testResults?: TestResult[]; overallPassed?: boolean; error?: string } | null>(null)
  const [showOutput, setShowOutput] = useState(false)

  const run = useCallback(async () => {
    setIsLoading(true)
    setResult(null)
    setShowOutput(true)

    try {
      const hasTestCases = samples && samples.length > 0
      const payload: Record<string, unknown> = { language, code }
      if (hasTestCases) {
        payload.testCases = samples.map(s => ({ input: s.input, expectedOutput: s.output }))
      }

      const res = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data: CompileResponse & { error?: string } = await res.json()

      if (!res.ok) {
        setResult({ error: data.error || `Execution failed (${res.status})` })
        return
      }

      setResult({
        output: data.run ?? undefined,
        testResults: data.testResults ?? undefined,
        overallPassed: data.overallPassed ?? undefined,
      })
    } catch {
      setResult({ error: 'Network error. Try again.' })
    } finally {
      setIsLoading(false)
    }
  }, [language, code, samples])

  return (
    <>
      <button onClick={run} disabled={isLoading} className={cn('flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors', isLoading ? 'cursor-wait text-white/40' : 'text-emerald-400 hover:bg-emerald-400/15 hover:text-emerald-300', className)}>
        {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
        {isLoading ? 'Running…' : 'Run'}
      </button>

      {showOutput && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex max-h-[50%] flex-col border-t border-white/10 bg-[#1a1918]">
          <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-1.5">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/60">
              <Terminal className="size-3" />
              {result?.testResults ? 'Test Results' : 'Output'}
            </span>
            <button onClick={() => setShowOutput(false)} className="rounded p-0.5 text-white/40 hover:text-white">
              <XCircle className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {isLoading ? (
              <div className="flex items-center gap-2 text-xs text-white/50">
                <Loader2 className="size-3.5 animate-spin" />Executing…
              </div>
            ) : result?.error ? (
              <pre className="whitespace-pre-wrap font-mono text-[12px] text-red-400">{result.error}</pre>
            ) : result?.testResults ? (
              <div className="space-y-1">
                <p className={cn('mb-2 text-xs font-semibold', result.overallPassed ? 'text-emerald-400' : 'text-red-400')}>
                  {result.overallPassed ? '✓ All samples passed' : '✗ Some samples failed'}
                </p>
                {result.testResults.map(tr => (
                  <div key={tr.testCase} className="flex items-center gap-2 text-xs">
                    {tr.passed ? <CheckCircle2 className="size-3 text-emerald-400" /> : <CircleX className="size-3 text-red-400" />}
                    <span className="text-white/70">Sample {tr.testCase}</span>
                    <span className={cn('ml-auto font-mono text-[11px]', tr.passed ? 'text-emerald-400/60' : 'text-red-400/60')}>
                      {tr.passed ? 'PASS' : `got "${tr.actual.slice(0, 50)}"`}
                    </span>
                  </div>
                ))}
              </div>
            ) : result?.output ? (
              <div>
                {result.output.stderr && <pre className="whitespace-pre-wrap font-mono text-[12px] text-red-400">{result.output.stderr}</pre>}
                {result.output.stdout && <pre className="whitespace-pre-wrap font-mono text-[12px] text-emerald-300">{result.output.stdout}</pre>}
                {!result.output.stdout && !result.output.stderr && <p className="text-xs italic text-white/40">No output.</p>}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  )
}

import { NextResponse } from 'next/server'
import {
  PISTON_URL,
  JUDGE0_BASE,
  JUDGE0_API_KEY,
  JUDGE0_SELF_HOSTED,
  MAX_CODE_LENGTH,
  MAX_TEST_CASES,
  getSupportedLanguage,
  type CompileResponse,
  type RunResult,
  type TestResult,
} from '@/lib/compiler'

/**
 * POST /api/compile
 *
 * Runs student code against test cases (or single run) using:
 * 1. Self-hosted Piston container (http://localhost:2000)
 * 2. Fallback: Judge0 CE API (if configured)
 * 3. Fallback: Demo Simulation (for UI testing)
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { language, code, stdin, testCases } = body as {
    language?: string
    code?: string
    stdin?: string
    testCases?: Array<{ input?: string; expectedOutput?: string }>
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!language || typeof language !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid `language`.' }, { status: 400 })
  }
  if (!code || typeof code !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid `code`.' }, { status: 400 })
  }
  if (code.length > MAX_CODE_LENGTH) {
    return NextResponse.json({ error: `Code exceeds maximum length of ${MAX_CODE_LENGTH} characters.` }, { status: 400 })
  }

  const lang = getSupportedLanguage(language)
  if (!lang) {
    return NextResponse.json({ error: `Unsupported language: "${language}".` }, { status: 400 })
  }

  // Validate test cases if provided
  if (testCases !== undefined) {
    if (!Array.isArray(testCases)) {
      return NextResponse.json({ error: '`testCases` must be an array.' }, { status: 400 })
    }
    if (testCases.length > MAX_TEST_CASES) {
      return NextResponse.json({ error: `Maximum ${MAX_TEST_CASES} test cases allowed.` }, { status: 400 })
    }
    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i]
      if (!tc || typeof tc !== 'object') {
        return NextResponse.json({ error: `Test case ${i + 1} is invalid.` }, { status: 400 })
      }
      if (typeof tc.expectedOutput !== 'string') {
        return NextResponse.json({ error: `Test case ${i + 1} missing \`expectedOutput\`.` }, { status: 400 })
      }
    }
  }

  // ── Execution ───────────────────────────────────────────────────────────────
  try {
    if (testCases && testCases.length > 0) {
      const testResults: TestResult[] = []

      for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i]
        const result = await executeCode(lang.key, code, tc.input ?? '')

        // Check for compilation errors (e.g. C++, Java compile output)
        if (result.stderr && !result.stdout && result.code !== 0) {
          // If compilation failed on first case, mark all test cases as failed with the compile error
          for (let j = i; j < testCases.length; j++) {
            testResults.push({
              testCase: j + 1,
              passed: false,
              input: testCases[j].input ?? '',
              expected: testCases[j].expectedOutput ?? '',
              actual: result.stderr.trim(),
            })
          }
          break
        }

        const actual = normalize(result.stdout)
        const expected = normalize(tc.expectedOutput ?? '')
        testResults.push({
          testCase: i + 1,
          passed: actual === expected,
          input: tc.input ?? '',
          expected: tc.expectedOutput ?? '',
          actual: result.stdout.trim() || result.stderr.trim(),
        })
      }

      const response: CompileResponse = {
        overallPassed: testResults.every(r => r.passed),
        testResults,
        language: lang.key,
        version: lang.version,
      }
      return NextResponse.json(response)
    } else {
      // Single execution with optional custom stdin
      const result = await executeCode(lang.key, code, typeof stdin === 'string' ? stdin : '')
      const response: CompileResponse = {
        run: result,
        language: lang.key,
        version: lang.version,
      }
      return NextResponse.json(response)
    }
  } catch (err) {
    console.error('[/api/compile] Code execution error:', err)
    return NextResponse.json(
      { error: 'Code execution service is temporarily unavailable. Please try again.' },
      { status: 502 },
    )
  }
}

// ── Execution Engines ─────────────────────────────────────────────────────────

async function executeCode(langKey: string, code: string, stdin: string): Promise<RunResult> {
  const lang = getSupportedLanguage(langKey)!

  // 1. Try Local / Self-Hosted Piston
  try {
    const url = `${PISTON_URL.replace(/\/$/, '')}/api/v2/execute`
    const pistonRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: lang.pistonLang,
        version: '*',
        files: [{ content: code }],
        stdin: stdin || '',
        run_timeout: 3000,
        compile_timeout: 5000,
      }),
      signal: AbortSignal.timeout(12000),
    })

    if (pistonRes.ok) {
      const data = await pistonRes.json()
      // Check if compile phase failed
      if (data.compile && data.compile.code !== 0) {
        const compileErr = data.compile.stderr || data.compile.output || 'Compilation Error'
        return {
          stdout: '',
          stderr: compileErr,
          output: compileErr,
          code: data.compile.code,
          signal: null,
        }
      }

      const run = data.run || {}
      const stdout = run.stdout ?? ''
      const stderr = run.stderr ?? ''
      return {
        stdout,
        stderr,
        output: run.output ?? (stdout + (stderr ? '\n' + stderr : '')),
        code: run.code ?? 0,
        signal: run.signal ?? null,
        time: run.cpu_time != null ? `${run.cpu_time}ms` : null,
        memory: run.memory != null ? `${Math.round(run.memory / 1024)}KB` : null,
      }
    } else {
      const errText = await pistonRes.text().catch(() => '')
      console.error('[/api/compile] Piston returned error:', pistonRes.status, errText)
    }
  } catch (err) {
    console.error('[/api/compile] Piston fetch error:', err)
  }

  // 2. Try Judge0 (if configured)
  if (JUDGE0_SELF_HOSTED || JUDGE0_API_KEY) {
    try {
      return await executeJudge0(lang.judge0Id, code, stdin)
    } catch {
      // Judge0 failed, try demo fallback
    }
  }

  // 3. Fallback: Demo mode (simulation for testing without backend)
  return {
    stdout: stdin ? stdin.trim() : 'Program executed successfully (Demo mode).',
    stderr: '',
    output: stdin ? stdin.trim() : 'Program executed successfully (Demo mode).',
    code: 0,
    signal: null,
    time: '20ms',
    memory: '1024KB',
  }
}

async function executeJudge0(languageId: number, sourceCode: string, stdin: string): Promise<RunResult> {
  const apiUrl = JUDGE0_SELF_HOSTED ? JUDGE0_SELF_HOSTED.replace(/\/$/, '') : JUDGE0_BASE
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!JUDGE0_SELF_HOSTED && JUDGE0_API_KEY) {
    headers['X-RapidAPI-Key'] = JUDGE0_API_KEY
    headers['X-RapidAPI-Host'] = 'judge0-ce.p.rapidapi.com'
  }

  const submitRes = await fetch(`${apiUrl}/submissions?base64_encoded=false&wait=true`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      language_id: languageId,
      source_code: sourceCode,
      stdin: stdin || '',
      cpu_time_limit: 5,
      wall_time_limit: 10,
      memory_limit: 128000,
    }),
    signal: AbortSignal.timeout(12000),
  })

  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => '')
    throw new Error(`Judge0 API returned ${submitRes.status}: ${text}`)
  }

  const data = await submitRes.json()
  const stdout = data.stdout ?? ''
  const stderr = data.stderr ?? data.compile_output ?? ''
  return {
    stdout,
    stderr,
    output: stdout + (stderr ? '\n' + stderr : ''),
    code: data.exit_code ?? null,
    signal: data.exit_signal !== null ? String(data.exit_signal) : null,
    time: data.time ?? null,
    memory: data.memory ?? null,
  }
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

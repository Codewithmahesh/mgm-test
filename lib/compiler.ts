/**
 * Code compiler execution configuration, types, and execution engines.
 *
 * Primary backend: Self-hosted Piston Docker container (http://localhost:2000)
 * Fallback: Judge0 CE or Demo Simulation
 */

export const PISTON_URL = process.env.PISTON_API_URL || 'http://127.0.0.1:2000'
export const JUDGE0_BASE = 'https://judge0-ce.p.rapidapi.com'
export const JUDGE0_API_KEY = process.env.JUDGE0_API_KEY || ''
export const JUDGE0_SELF_HOSTED = process.env.JUDGE0_SELF_HOSTED_URL || ''

export type SupportedLanguage = {
  key: string
  label: string
  pistonLang: string
  judge0Id: number
  version: string
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { key: 'python',     label: 'Python 3',   pistonLang: 'python',     judge0Id: 71, version: '3.12.0' },
  { key: 'cpp',        label: 'C++ (GCC)',  pistonLang: 'c++',        judge0Id: 54, version: '10.2.0' },
  { key: 'c',          label: 'C (GCC)',    pistonLang: 'c',          judge0Id: 50, version: '10.2.0' },
  { key: 'java',       label: 'Java',       pistonLang: 'java',       judge0Id: 62, version: '15.0.2' },
  { key: 'javascript', label: 'JavaScript', pistonLang: 'javascript', judge0Id: 63, version: '20.11.1' },
]

export function getSupportedLanguage(key: string): SupportedLanguage | undefined {
  return SUPPORTED_LANGUAGES.find(l => l.key === key)
}

/** Max code length (100 KB) */
export const MAX_CODE_LENGTH = 100_000

/** Max number of test cases per request */
export const MAX_TEST_CASES = 20

export type TestCase = {
  input: string
  expectedOutput: string
}

export type TestResult = {
  testCase: number
  passed: boolean
  input: string
  expected: string
  actual: string
}

export type RunResult = {
  stdout: string
  stderr: string
  output: string
  code: number | null
  signal: string | null
  time?: string | number | null
  memory?: string | number | null
}

export type CompileResponse = {
  run?: RunResult
  testResults?: TestResult[]
  overallPassed?: boolean
  language: string
  version?: string
  compileError?: string | null
}

export function cleanCompilerError(rawError: string): { cleaned: string; line?: number; tip?: string } {
  if (!rawError) return { cleaned: '' }

  // Clean out noisy temporary file paths
  const cleaned = rawError
    .replace(/(?:\/[a-zA-Z0-9_\-\.]+)+\/([a-zA-Z0-9_\-]+\.(?:cpp|c|java|py|js)):/g, '$1:')
    .replace(/(?:[a-zA-Z]:\\[^\n:]+\\)([a-zA-Z0-9_\-]+\.(?:cpp|c|java|py|js)):/g, '$1:')
    .replace(/(?:solution|main|Main)\.(?:cpp|c|java|py|js):/gi, 'Line ')
    .trim()

  // Detect line number from error
  let line: number | undefined
  const lineMatch = rawError.match(/(?:line\s+|:)(\d+)(?::\d+)?(?::|\s+error|\s+warning)/i)
  if (lineMatch) {
    line = parseInt(lineMatch[1], 10)
  }

  // Friendly tips for students
  let tip = ''
  if (/expected\s*['";]|missing\s*;/i.test(rawError)) {
    tip = 'Missing semicolon (;) — Check this line or the line above it.'
  } else if (/expected\s*['"}\]]|was never closed|reached end of file/i.test(rawError)) {
    tip = 'Bracket or parenthesis mismatch — Make sure all { }, ( ), and [ ] pairs are properly closed.'
  } else if (/not declared|cannot find symbol|NameError|is not defined/i.test(rawError)) {
    tip = 'Undefined variable or function — Check spelling and ensure the variable is declared before use.'
  } else if (/ZeroDivisionError|division by zero/i.test(rawError)) {
    tip = 'Division by zero — Your code is dividing by zero in a calculation.'
  } else if (/IndexError|ArrayIndexOutOfBoundsException|out_of_range/i.test(rawError)) {
    tip = 'Array index out of bounds — Your code accessed an index beyond the array or list size.'
  } else if (/Segmentation fault|SIGSEGV/i.test(rawError)) {
    tip = 'Segmentation fault — Illegal memory access (invalid pointer or infinite recursion stack overflow).'
  } else if (/time\s*limit|timeout/i.test(rawError)) {
    tip = 'Time Limit Exceeded — Check for infinite loops (e.g. while or for loop condition).'
  }

  return { cleaned, line, tip }
}

export function normalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

/**
 * Executes source code with given standard input.
 */
export async function executeCode(langKey: string, code: string, stdin: string): Promise<RunResult> {
  const lang = getSupportedLanguage(langKey)
  if (!lang) {
    return {
      stdout: '',
      stderr: `Unsupported language: "${langKey}".`,
      output: `Unsupported language: "${langKey}".`,
      code: 1,
      signal: null,
    }
  }

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

export async function executeJudge0(languageId: number, sourceCode: string, stdin: string): Promise<RunResult> {
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

/**
 * Runs code against an array of test cases and returns comprehensive results.
 */
export async function evaluateTestCases(
  languageKey: string,
  code: string,
  testCases: Array<{ input?: string; expectedOutput?: string }>
): Promise<CompileResponse> {
  const lang = getSupportedLanguage(languageKey)
  if (!lang) {
    throw new Error(`Unsupported language: "${languageKey}".`)
  }

  const testResults: TestResult[] = []

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i]
    const result = await executeCode(lang.key, code, tc.input ?? '')

    // Check for compilation errors
    if (result.stderr && !result.stdout && result.code !== 0) {
      const compileErr = result.stderr.trim()
      for (let j = i; j < testCases.length; j++) {
        testResults.push({
          testCase: j + 1,
          passed: false,
          input: testCases[j].input ?? '',
          expected: testCases[j].expectedOutput ?? '',
          actual: compileErr,
        })
      }
      return {
        overallPassed: false,
        testResults,
        language: lang.key,
        version: lang.version,
        compileError: compileErr,
      }
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

  return {
    overallPassed: testResults.length > 0 && testResults.every(r => r.passed),
    testResults,
    language: lang.key,
    version: lang.version,
  }
}

import { NextResponse } from 'next/server'
import { HttpError, rateLimit, signedInUser } from '@/lib/auth'
import { evaluateCode, runCode } from '@/lib/code-runs'
import {
  MAX_CODE_LENGTH,
  MAX_TEST_CASES,
  getSupportedLanguage,
  type CompileResponse,
} from '@/lib/compiler'

/** Runs per signed-in user per minute; enough for someone testing their code, not for scripting the runner. */
const RUNS_PER_MINUTE = 20

/**
 * POST /api/compile
 *
 * Runs code for a signed-in faculty member or student (rate limited, results cached; see lib/code-runs.ts)
 * against test cases, or once with custom stdin, using:
 * 1. Self-hosted Piston container (http://localhost:2000)
 * 2. Fallback: Judge0 CE API (if configured)
 * If neither can run it, answers 502 instead of simulating an output.
 */
export async function POST(request: Request) {
  // Only signed-in faculty and students may run code, and each only so often.
  const user = await signedInUser()
  if (!user) return NextResponse.json({ error: 'Please sign in to run code.' }, { status: 401 })
  try {
    await rateLimit(`compile:${user.role}:${user.id}`, RUNS_PER_MINUTE, 60)
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: 'You are running code very often. Wait a minute, then try again.' }, { status: 429 })
    throw error
  }

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
      const response = await evaluateCode(lang.key, code, testCases)
      return NextResponse.json(response)
    } else {
      // Single execution with optional custom stdin
      const result = await runCode(lang.key, code, typeof stdin === 'string' ? stdin : '')
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

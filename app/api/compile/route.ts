import { NextResponse } from 'next/server'
import {
  MAX_CODE_LENGTH,
  MAX_TEST_CASES,
  getSupportedLanguage,
  executeCode,
  evaluateTestCases,
  type CompileResponse,
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
      const response = await evaluateTestCases(lang.key, code, testCases)
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

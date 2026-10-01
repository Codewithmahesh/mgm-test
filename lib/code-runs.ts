import 'server-only'
import { createHash } from 'node:crypto'
import { evaluateTestCases, executeCode, type RunResult } from './compiler'
import { connectDb } from './db'
import { CodeRun } from './models'

/**
 * How the server runs students' code without flooding the code runner (Piston / Judge0):
 * - every result is cached for a week by (language, code, input), so a "Run" during the exam makes
 *   grading at submit free, and regrades or identical programs never run again;
 * - one server instance runs at most MAX_RUNNING programs at a time; the rest wait their turn;
 * - the test cases of one program run TEST_PARALLEL at a time after the first (see evaluateTestCases).
 */
const MAX_RUNNING = 6
const TEST_PARALLEL = 3
const CACHE_DAYS = 7

let running = 0
const waiting: (() => void)[] = []

async function acquire() {
  if (running < MAX_RUNNING) { running++; return }
  await new Promise<void>(resolve => waiting.push(resolve)) // the slot is handed over by release()
}

function release() {
  const next = waiting.shift()
  if (next) next()
  else running--
}

/** Runs one program, from the cache when this exact run has happened before. */
export async function runCode(langKey: string, code: string, stdin: string): Promise<RunResult> {
  const key = createHash('sha256').update(JSON.stringify([langKey, code, stdin])).digest('hex')
  await connectDb()
  const hit = await CodeRun.findById(key).select('result').lean().catch(() => null)
  if (hit) return hit.result as RunResult

  await acquire()
  let result: RunResult
  try { result = await executeCode(langKey, code, stdin) } finally { release() }

  // A run that hit the time limit can pass on a quieter runner, so it is not kept.
  if (!result.signal && !/time limit|timed? ?out/i.test(`${result.stderr}`)) {
    await CodeRun.updateOne({ _id: key }, { $set: { result, expiresAt: new Date(Date.now() + CACHE_DAYS * 86_400_000) } }, { upsert: true }).catch(() => {})
  }
  return result
}

/** evaluateTestCases through the cache and the shared limit. */
export function evaluateCode(langKey: string, code: string, testCases: Array<{ input?: string; expectedOutput?: string }>) {
  return evaluateTestCases(langKey, code, testCases, runCode, TEST_PARALLEL)
}

/**
 * Code compiler execution configuration and types.
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
}

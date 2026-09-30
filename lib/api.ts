// Client-side fetch helper and shared types. JSON in, JSON out; throws an Error with the server's message.

import type { BloomLevel, BloomPlan } from './bloom'

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message)
  }
}

export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData
  const response = await fetch(path, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers: { ...(options.body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    body: options.body ? (isForm ? (options.body as FormData) : JSON.stringify(options.body)) : undefined,
    cache: 'no-store',
  })
  const data = await response.json().catch(() => ({}))
  if (typeof window !== 'undefined' && !path.includes('/auth/')) {
    const here = window.location.pathname
    if (response.status === 401) {
      const login = here.startsWith('/student') ? '/student/login' : '/teacher/login'
      if (!here.startsWith(login)) window.location.href = `${login}?next=${encodeURIComponent(here)}`
    }
    if (response.status === 403 && here.startsWith('/student') && data.error?.includes('Complete your profile') && here !== '/student/profile') {
      window.location.href = '/student/profile'
    }
  }
  if (!response.ok) throw new ApiError(response.status, data.error || `Request failed (${response.status})`, data.code)
  return data as T
}

export const errorMessage = (error: unknown, fallback = 'Something went wrong.') => (error instanceof Error ? error.message : fallback)

export type RoomStatus = 'draft' | 'open' | 'closed'

export type Room = {
  id: string
  title: string
  description: string
  instructions: string
  code: string
  questionsPerStudent: number
  codingQuestions: number
  marksPerQuestion: number
  negativeMarks: number
  codingMarks: number
  durationMinutes: number
  startsAt: string | null
  autoOpen: boolean
  status: RoomStatus
  showResults: 'after_submit' | 'after_end' | 'never'
  allowedClassrooms: string[]
  requireFullscreen: boolean
  blockCopyPaste: boolean
  maxViolations: number
  requireApproval: boolean
  createdAt: string
  updatedAt: string
  poolSize: number
  mcqPoolSize: number
  codingPoolSize: number
  joined: number
  submitted: number
  pendingReview: number
  flagged: number
  waiting: number
  paperMode: 'random' | 'sets'
  setCount: number
  bloomPlan: BloomPlan
  averagePercent: number | null
}

export type Sample = { input: string; output: string; explanation: string }

export type DraftQuestion = {
  type: 'mcq' | 'tf' | 'coding'
  text: string
  options: string[]
  correctIndex: number | null
  topic: string
  bloom: BloomLevel | null
  set: string
  explanation: string
  title: string
  inputFormat: string
  outputFormat: string
  constraints: string
  samples: Sample[]
  points: number | null
  language: string
  starterCode: string
  imageUrl?: string
}

export type BankQuestion = DraftQuestion & { id: string; room: string | null; source: 'csv' | 'ai' | 'manual'; createdAt: string }

export type Classroom = { id: string; label: string; year: string; branch: string; division: string; students: number; active: number }

export type StudentRow = {
  id: string
  email: string
  name: string
  rollNumber: string
  prn: string
  classroomId: string | null
  year: string
  branch: string
  division: string
  classLabel: string
  status: 'active' | 'invited'
  profileComplete: boolean
  activatedAt: string | null
  createdAt: string | null
}

export const statusMeta: Record<RoomStatus, { label: string; tone: 'amber' | 'green' | 'neutral' }> = {
  draft: { label: 'Draft', tone: 'amber' },
  open: { label: 'Live', tone: 'green' },
  closed: { label: 'Ended', tone: 'neutral' },
}

export const LANGUAGE_OPTIONS = [
  { value: 'cpp', label: 'C++ 17', monaco: 'cpp' },
  { value: 'c', label: 'C', monaco: 'c' },
  { value: 'java', label: 'Java 17', monaco: 'java' },
  { value: 'python', label: 'Python 3', monaco: 'python' },
  { value: 'javascript', label: 'JavaScript (Node)', monaco: 'javascript' },
] as const

export const STARTER_CODE: Record<string, string> = {
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    // your code goes here\n\n    return 0;\n}\n',
  c: '#include <stdio.h>\n\nint main(void) {\n    // your code goes here\n\n    return 0;\n}\n',
  java: 'import java.util.*;\nimport java.io.*;\n\npublic class Main {\n    public static void main(String[] args) throws IOException {\n        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));\n        // your code goes here\n    }\n}\n',
  python: 'import sys\n\ndef main():\n    data = sys.stdin.read().split()\n    # your code goes here\n\nif __name__ == "__main__":\n    main()\n',
  javascript: "const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\n\n// your code goes here\n",
}

export function languageLabel(value: string) {
  return LANGUAGE_OPTIONS.find(option => option.value === value)?.label ?? (value || 'Code')
}

export function relativeTime(value: string | Date | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  const seconds = Math.round((Date.now() - date.getTime()) / 1000)
  if (seconds < 0) {
    const ahead = -seconds
    if (ahead < 3600) return `in ${Math.max(1, Math.round(ahead / 60))} min`
    if (ahead < 86400) return `in ${Math.round(ahead / 3600)} h`
    return formatDate(date)
  }
  if (seconds < 45) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
  if (seconds < 172800) return 'yesterday'
  return formatDate(date)
}

export function formatDate(value: string | Date | null | undefined, withTime = false) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-IN', withTime ? { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds == null) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`
}

export function clock(seconds: number) {
  const s = Math.max(0, seconds)
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':')
}

export const letter = (index: number | null | undefined) => (index == null || index < 0 ? '—' : String.fromCharCode(65 + index))

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '?'

export function downloadFile(url: string) {
  const link = document.createElement('a')
  link.href = url
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export const YEAR_OPTIONS = [
  { value: 'FY', label: 'First Year (FY)' },
  { value: 'SY', label: 'Second Year (SY)' },
  { value: 'TY', label: 'Third Year (TY)' },
  { value: 'B.Tech', label: 'B.Tech' },
]

export const BRANCH_OPTIONS = [
  { value: 'CSE', label: 'Computer Science & Engineering' },
  { value: 'AIML', label: 'Artificial Intelligence & Machine Learning' },
  { value: 'IT', label: 'Information Technology' },
  { value: 'ENTC', label: 'Electronics & Telecommunication' },
  { value: 'MECH', label: 'Mechanical Engineering' },
  { value: 'CIVIL', label: 'Civil Engineering' },
  { value: 'EE', label: 'Electrical Engineering' },
]

export const DEPARTMENT_OPTIONS = [
  { value: 'Computer Science & Engineering', label: 'Computer Science & Engineering' },
  { value: 'Artificial Intelligence & Machine Learning', label: 'Artificial Intelligence & Machine Learning' },
  { value: 'Information Technology', label: 'Information Technology' },
  { value: 'Electronics & Telecommunication Engineering', label: 'Electronics & Telecommunication Engineering' },
  { value: 'Mechanical Engineering', label: 'Mechanical Engineering' },
  { value: 'Civil Engineering', label: 'Civil Engineering' },
  { value: 'Electrical Engineering', label: 'Electrical Engineering' },
  { value: 'Basic Sciences & Humanities', label: 'Basic Sciences & Humanities' },
]

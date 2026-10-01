// Client-side shapes of the practicals API (see app/api/practicals and app/api/student/practicals).

import type { DraftQuestion, Sample } from './api'

export type PracticalSubject = {
  id: string
  title: string
  code: string
  description: string
  classrooms: string[]
  classLabels: string[]
  experiments: number
  students: number
  completionPercent: number | null
  createdAt: string | null
}

export type Problem = {
  id: string
  title: string
  text: string
  inputFormat: string
  outputFormat: string
  constraints: string
  samples: Sample[]
  /** Faculty views only. */
  hiddenTests?: Sample[]
  hiddenCount: number
  topic: string
  language: string
  starterCode: string
}

export type FacultyExperiment = Problem & { order: number; poolSize: number; aiPracticeCount: number }

export type CellStatus = 'solved' | 'attempted' | 'open' | 'locked'

export type ProgressCell = {
  experiment: string
  status: CellStatus
  attempts: number
  solvedAt: string | null
  hiddenPassed: number | null
  hiddenTotal: number | null
  practiceSolved: number
  practiceAttempted: number
}

export type Progress = {
  experiments: { id: string; order: number; title: string; solvedBy: number; attemptedBy: number }[]
  students: { id: string; name: string; rollNumber: string; classLabel: string; solved: number; practiceSolved: number; practiceAttempted: number; lastActivity: string | null; cells: ProgressCell[] }[]
}

export type StudentSubmission = {
  id: string
  experiment: { id: string; order: number; title: string } | null
  practice: { id: string; title: string; source: 'faculty' | 'ai' } | null
  language: string
  code: string
  samplesPassed: number
  samplesTotal: number
  hiddenPassed: number
  hiddenTotal: number
  solved: boolean
  compileError: string
  createdAt: string
}

export type MyPractical = {
  id: string
  title: string
  code: string
  description: string
  faculty: string
  experiments: number
  solved: number
  next: { id: string; order: number; title: string } | null
  practiceSolved: number
}

export type MyLevel = {
  id: string
  order: number
  title: string
  topic: string
  status: 'solved' | 'open' | 'locked'
  attempts: number
  solvedAt: string | null
  hiddenPassed: number | null
  hiddenTotal: number
  practiceSolved: number
}

export type SolveView = {
  subject: { id: string; title: string; code: string }
  experiment: { id: string; order: number; title: string; status: 'solved' | 'open' }
  problem: Problem
  practiceProblem: { id: string; source: 'faculty' | 'ai' } | null
  lastCode: { language: string; code: string } | null
  history: { id: string; language: string; samplesPassed: number; samplesTotal: number; hiddenPassed: number; hiddenTotal: number; solved: boolean; compileError: string; createdAt: string }[]
  practice: { id: string; title: string; source: 'faculty' | 'ai'; solved: boolean; attempts: number }[]
  canGenerate: boolean
}

export type SubmitResult = {
  samplesPassed: number
  samplesTotal: number
  hiddenPassed: number
  hiddenTotal: number
  solved: boolean
  compileError: string
  sampleResults: { testCase: number; passed: boolean; input: string; expected: string; actual: string }[]
  unlocked: { id: string; order: number; title: string } | null
}

/** A problem in the shape the question editor edits. */
export function problemToDraft(p: Partial<Problem>): DraftQuestion {
  return {
    type: 'coding', text: p.text ?? '', options: [], correctIndex: null, topic: p.topic ?? '', bloom: null, set: '', explanation: '',
    title: p.title ?? '', inputFormat: p.inputFormat ?? '', outputFormat: p.outputFormat ?? '', constraints: p.constraints ?? '',
    samples: p.samples?.length ? p.samples : [{ input: '', output: '', explanation: '' }], hiddenTests: p.hiddenTests ?? [],
    points: null, language: p.language ?? '', starterCode: p.starterCode ?? '', imageUrl: '',
  }
}

/** The editor's draft as a request body for the practical problem endpoints. */
export function draftToProblem(q: DraftQuestion) {
  return { title: q.title, text: q.text, inputFormat: q.inputFormat, outputFormat: q.outputFormat, constraints: q.constraints, samples: q.samples, hiddenTests: q.hiddenTests ?? [], topic: q.topic, language: q.language, starterCode: q.starterCode }
}

// Shape of a student's result analysis (built in lib/analysis.ts), shared with the web and app UIs.

/** Performance in one area (a topic, a Bloom's level or a question type). */
export type AreaStat = {
  key: string
  label: string
  /** Marks earned (MCQ negative marks included) and marks available. */
  earned: number
  possible: number
  /** earned / possible, 0–100 (never below 0). */
  percent: number
  questions: number
  correct: number
  wrong: number
  skipped: number
  /** Coding problems in this area still waiting for marks. */
  pending: number
}

/** A question the student lost marks on, shown under the weak area it belongs to. */
export type MissedQuestion = {
  number: number
  type: 'mcq' | 'tf' | 'coding'
  /** Question text, or the coding problem's title. */
  text: string
  result: 'wrong' | 'skipped' | 'partial'
  /** The option the student chose ("B. Queue"), or null when skipped / coding. */
  yourAnswer: string | null
  /** The correct option ("C. Stack"), or null for coding. */
  correctAnswer: string | null
  explanation: string
  /** Marks this question cost: missed marks plus any negative marking. */
  marksLost: number
  /** Coding: marks given out of the problem's marks, and the faculty's feedback. */
  marks?: { earned: number; possible: number }
  feedback?: string
}

/** One weak area with exactly what went wrong in it. */
export type FocusArea = { area: AreaStat; missed: MissedQuestion[]; advice: string }

export type ResultAnalysis = {
  percent: number
  band: { label: 'Excellent' | 'Good' | 'Average' | 'Needs improvement'; tone: 'green' | 'blue' | 'amber' | 'red' }
  /** Correct answers out of the MCQs attempted, 0–100 (null when nothing was attempted). */
  accuracy: number | null
  attempted: number
  correct: number
  wrong: number
  skipped: number
  /** Marks lost to negative marking. */
  negativeLost: number
  mcq: { earned: number; possible: number; questions: number }
  coding: { earned: number; possible: number; questions: number; pending: number }
  byTopic: AreaStat[]
  byLevel: AreaStat[]
  strong: AreaStat[]
  weak: AreaStat[]
  /** Where the student stands among everyone who submitted (null when they're the only one). */
  classStats: { rank: number; of: number; average: number; highest: number; percentile: number } | null
  timeTakenSeconds: number | null
  durationMinutes: number
  tips: string[]
  /** Weak areas of this test, weakest first, each with the questions missed in it. */
  focus: FocusArea[]
}

export const STRONG_AT = 75
export const WEAK_BELOW = 50

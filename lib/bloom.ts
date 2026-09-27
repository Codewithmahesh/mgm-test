// Bloom's taxonomy levels: shared by the server (dealing, grading, validation) and the UI.

export const BLOOM_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const
export type BloomLevel = (typeof BLOOM_LEVELS)[number]

export const BLOOM_INFO: Record<BloomLevel, { n: number; label: string; hint: string; tone: 'neutral' | 'blue' | 'green' | 'amber' | 'violet' | 'red' }> = {
  remember: { n: 1, label: 'Remember', hint: 'Recall facts, terms and definitions', tone: 'neutral' },
  understand: { n: 2, label: 'Understand', hint: 'Explain ideas, classify, summarise', tone: 'blue' },
  apply: { n: 3, label: 'Apply', hint: 'Use a concept or method in a new situation', tone: 'green' },
  analyze: { n: 4, label: 'Analyze', hint: 'Break down, compare, find relationships', tone: 'amber' },
  evaluate: { n: 5, label: 'Evaluate', hint: 'Judge, justify, choose the best option', tone: 'violet' },
  create: { n: 6, label: 'Create', hint: 'Design, construct or produce something new', tone: 'red' },
}

export const bloomLabel = (level: string | null | undefined) => (level && level in BLOOM_INFO ? `L${BLOOM_INFO[level as BloomLevel].n} ${BLOOM_INFO[level as BloomLevel].label}` : 'No level')

// Accepts "3", "L3", "apply", "Applying", "application", old-Bloom names ("knowledge", "comprehension", "synthesis")…
const ALIASES: Record<string, BloomLevel> = {
  '1': 'remember', l1: 'remember', remember: 'remember', remembering: 'remember', knowledge: 'remember', recall: 'remember',
  '2': 'understand', l2: 'understand', understand: 'understand', understanding: 'understand', comprehension: 'understand', comprehend: 'understand',
  '3': 'apply', l3: 'apply', apply: 'apply', applying: 'apply', application: 'apply',
  '4': 'analyze', l4: 'analyze', analyze: 'analyze', analyse: 'analyze', analyzing: 'analyze', analysing: 'analyze', analysis: 'analyze',
  '5': 'evaluate', l5: 'evaluate', evaluate: 'evaluate', evaluating: 'evaluate', evaluation: 'evaluate',
  '6': 'create', l6: 'create', create: 'create', creating: 'create', creation: 'create', synthesis: 'create',
}

export function normalizeBloom(value: unknown): BloomLevel | null {
  const key = String(value ?? '').toLowerCase().replace(/^(level|bloom|bl|k)\s*/, '').replace(/[^a-z0-9]/g, '')
  return ALIASES[key] ?? null
}

/** How many questions of each level every paper gets, and the marks for each of them. */
export type BloomPlanRow = { level: BloomLevel; count: number; marks: number }
export type BloomPlan = BloomPlanRow[]

export const planCount = (plan: BloomPlan | null | undefined) => (plan ?? []).reduce((sum, row) => sum + row.count, 0)

/**
 * Marks for one paper: planned questions at their level's marks, any questions not covered by the
 * plan at the default marks per MCQ, plus coding problems.
 */
export function paperMarks(room: { questionsPerStudent: number; marksPerQuestion: number; codingQuestions?: number | null; codingMarks?: number | null; bloomPlan?: BloomPlan | null }) {
  const plan = room.bloomPlan ?? []
  const planned = plan.reduce((sum, row) => sum + row.count * row.marks, 0)
  const rest = Math.max(0, room.questionsPerStudent - planCount(plan))
  const mcq = planned + rest * room.marksPerQuestion
  return { mcq: round(mcq), total: round(mcq + (room.codingQuestions ?? 0) * (room.codingMarks ?? 10)) }
}

// "Mixed" AI generation: share of each level (sums to 100).
export const MIXED_SHARES: Record<BloomLevel, number> = { remember: 20, understand: 25, apply: 25, analyze: 15, evaluate: 10, create: 5 }

/** Splits `count` by the given shares (largest remainder, ties to the lower level), e.g. 10 → 2/3/2/2/1/0. */
export function splitByShares(count: number, shares: number[] = BLOOM_LEVELS.map(level => MIXED_SHARES[level])) {
  const total = shares.reduce((a, b) => a + b, 0)
  if (!total || count <= 0) return shares.map(() => 0)
  const exact = shares.map(share => (share * count) / total)
  const split = exact.map(Math.floor)
  let left = count - split.reduce((a, b) => a + b, 0)
  const order = exact.map((value, i) => ({ i, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.i - b.i)
  for (const { i } of order) { if (left <= 0) break; split[i]++; left-- }
  return split
}

export const setName = (index: number) => String.fromCharCode(65 + index)
export const setNames = (count: number) => Array.from({ length: Math.max(0, count) }, (_, i) => setName(i))

const round = (value: number) => Math.round(value * 100) / 100

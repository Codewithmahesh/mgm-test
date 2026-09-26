// Shared by the server (opening a room) and the faculty UI (pool warnings).

export type PoolItem = { type: string; difficulty?: string | null; set?: string | null }
export type PaperConfig = {
  questionsPerStudent: number
  codingQuestions?: number | null
  paperMode?: string | null
  difficultyMix?: { easy?: number | null; medium?: number | null; hard?: number | null } | null
}

const LEVELS = ['easy', 'medium', 'hard'] as const

/** Set labels used in a pool, sorted (A, B, C…). Unlabelled questions are common to every set. */
export function setLabels(questions: { set?: string | null }[]) {
  return [...new Set(questions.map(q => q.set ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

/** A fixed difficulty mix, or null when the room balances difficulty automatically. */
export function fixedMix(config: PaperConfig) {
  const mix = config.difficultyMix
  return mix && (mix.easy || mix.medium || mix.hard) ? { easy: mix.easy ?? 0, medium: mix.medium ?? 0, hard: mix.hard ?? 0 } : null
}

/**
 * Everything that would stop every student getting an equal paper: a set (or the pool) with too few
 * questions, or too few questions of a difficulty the faculty fixed. Empty = ready.
 */
export function poolProblems(config: PaperConfig, pool: PoolItem[]) {
  const labels = config.paperMode === 'sets' ? setLabels(pool) : []
  const groups = labels.length
    ? labels.map(label => ({ name: `Set ${label}`, items: pool.filter(q => q.set === label || !q.set) }))
    : [{ name: 'The pool', items: pool }]
  const mix = fixedMix(config)
  const wantMcq = mix ? mix.easy + mix.medium + mix.hard : config.questionsPerStudent
  const wantCoding = config.codingQuestions ?? 0
  const problems: string[] = []
  for (const { name, items } of groups) {
    const mcqs = items.filter(q => q.type !== 'coding')
    const coding = items.length - mcqs.length
    if (mcqs.length < wantMcq) problems.push(`${name} has ${mcqs.length} MCQ${mcqs.length === 1 ? '' : 's'}; each student needs ${wantMcq}.`)
    if (coding < wantCoding) problems.push(`${name} has ${coding} coding problem${coding === 1 ? '' : 's'}; each student needs ${wantCoding}.`)
    if (mix) {
      for (const level of LEVELS) {
        const have = mcqs.filter(q => q.difficulty === level).length
        if (have < mix[level]) problems.push(`${name} has ${have} ${level} MCQ${have === 1 ? '' : 's'}; each paper needs ${mix[level]}.`)
      }
    }
  }
  return problems
}

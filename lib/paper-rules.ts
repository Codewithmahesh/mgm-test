// Shared by the server (opening a room, dealing papers) and the faculty UI (pool warnings).
import { BLOOM_INFO, setNames, type BloomLevel } from './bloom'

export type PoolItem = { type: string; bloom?: string | null; set?: string | null }
export type PaperConfig = {
  questionsPerStudent: number
  /** True/False per student; null on rooms made before it existed (see separateTf). */
  tfQuestions?: number | null
  codingQuestions?: number | null
  paperMode?: string | null
  setCount?: number | null
  bloomPlan?: { level: string; count?: number | null; marks?: number | null }[] | null
}

/**
 * Whether True/False questions have their own count on this room's papers. Rooms made before that
 * existed (tfQuestions unset) keep dealing them as MCQs, so their papers don't change.
 */
export const separateTf = (config: { tfQuestions?: number | null }) => config.tfQuestions != null

/** How a question counts on this room's papers. */
export function paperKind(config: { tfQuestions?: number | null }, type: string): 'mcq' | 'tf' | 'coding' {
  if (type === 'coding') return 'coding'
  return type === 'tf' && separateTf(config) ? 'tf' : 'mcq'
}

/** Set labels used in a pool, sorted (A, B, C…). Unlabelled questions are common to every set. */
export function setLabels(questions: { set?: string | null }[]) {
  return [...new Set(questions.map(q => q.set ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

/** The sets students are given in turn (A, B, C… up to the room's set count), or [] for random papers. */
export function activeSets(config: PaperConfig) {
  return config.paperMode === 'sets' && (config.setCount ?? 0) >= 2 ? setNames(config.setCount!) : []
}

/** The questions a student on `set` can get: that set plus the questions with no set. */
export const setPool = <T extends { set?: string | null }>(pool: T[], set: string) => pool.filter(q => q.set === set || !q.set)

/**
 * Everything that would stop every student getting an equal paper: a set (or the pool) with too few
 * questions, or too few questions at a Bloom level the plan asks for. Empty = ready.
 */
export function poolProblems(config: PaperConfig, pool: PoolItem[]) {
  const sets = activeSets(config)
  const groups = sets.length ? sets.map(set => ({ name: `Set ${set}`, items: setPool(pool, set) })) : [{ name: 'The pool', items: pool }]
  const wantMcq = config.questionsPerStudent
  const wantTf = config.tfQuestions ?? 0
  const wantCoding = config.codingQuestions ?? 0
  const problems: string[] = []
  for (const { name, items } of groups) {
    const mcqs = items.filter(q => paperKind(config, q.type) === 'mcq')
    const tf = items.filter(q => paperKind(config, q.type) === 'tf').length
    const coding = items.filter(q => q.type === 'coding').length
    if (mcqs.length < wantMcq) problems.push(`${name} has ${mcqs.length} MCQ${mcqs.length === 1 ? '' : 's'}; each student needs ${wantMcq}.`)
    if (tf < wantTf) problems.push(`${name} has ${tf} True/False question${tf === 1 ? '' : 's'}; each student needs ${wantTf}.`)
    if (coding < wantCoding) problems.push(`${name} has ${coding} coding problem${coding === 1 ? '' : 's'}; each student needs ${wantCoding}.`)
    for (const row of config.bloomPlan ?? []) {
      const need = row.count ?? 0
      const have = mcqs.filter(q => q.bloom === row.level).length
      if (have < need) problems.push(`${name} has ${have} "${BLOOM_INFO[row.level as BloomLevel]?.label ?? row.level}" MCQ${have === 1 ? '' : 's'}; each paper needs ${need}.`)
    }
  }
  return problems
}

import 'server-only'
import { BLOOM_INFO, BLOOM_LEVELS, type BloomLevel } from './bloom'
import { STRONG_AT, WEAK_BELOW, type AreaStat, type FocusArea, type MissedQuestion, type ResultAnalysis } from './analysis-types'
import { Attempt, ExamRoom, Question } from './models'

type AttemptDoc = NonNullable<Awaited<ReturnType<typeof Attempt.findOne>>>

const round = (value: number) => Math.round(value * 100) / 100
const pct = (earned: number, possible: number) => (possible > 0 ? Math.max(0, Math.min(100, Math.round((earned / possible) * 100))) : 0)

/** What to practise when a Bloom's level is weak. */
const LEVEL_TIPS: Record<BloomLevel, string> = {
  remember: 'Revise definitions, terms and key facts; short flash-card style recall helps.',
  understand: 'Explain each concept in your own words and compare similar ideas side by side.',
  apply: 'Solve more worked examples and practise using each method on new problems.',
  analyze: 'Practise breaking problems into steps and tracing code or processes line by line.',
  evaluate: 'Compare alternative answers and justify why one is best; review the explanations of wrong answers.',
  create: 'Practise designing small solutions from scratch before checking a reference.',
}

type Bucket = Omit<AreaStat, 'percent'>
type Outcome = { earned: number; possible: number; result: 'correct' | 'wrong' | 'skipped' | 'pending' }

const finish = (b: Bucket): AreaStat => ({ ...b, earned: round(b.earned), possible: round(b.possible), percent: pct(b.earned, b.possible) })

function addTo(map: Map<string, Bucket>, key: string, label: string, o: Outcome) {
  const b = map.get(key) ?? { key, label, earned: 0, possible: 0, questions: 0, correct: 0, wrong: 0, skipped: 0, pending: 0 }
  b.questions++
  b[o.result]++
  if (o.result !== 'pending') { b.earned += o.earned; b.possible += o.possible }
  map.set(key, b)
}

/**
 * Score analysis for one submitted attempt: marks by topic and by Bloom's level, strong and weak
 * areas, standing among everyone who submitted, and what to work on. Call it only once results are visible.
 */
export async function buildAnalysis(attempt: AttemptDoc): Promise<ResultAnalysis> {
  const [questions, room, classmates] = await Promise.all([
    Question.find({ _id: { $in: attempt.questions } }).select('type text title options correctIndex explanation topic bloom points').lean(),
    ExamRoom.findById(attempt.room).select('codingMarks durationMinutes').lean(),
    Attempt.find({ room: attempt.room, status: 'submitted' }).select('score maxScore startedAt submittedAt').lean(),
  ])
  const byId = new Map(questions.map(q => [String(q._id), q]))
  const codingMarks = new Map(attempt.codingMarks.map(m => [String(m.question), m.marks]))
  const negative = attempt.negativeMarks ?? 0

  const topics = new Map<string, Bucket>()
  const levels = new Map<string, Bucket>()
  const mcq = { earned: 0, possible: 0, questions: 0 }
  const coding = { earned: 0, possible: 0, questions: 0, pending: 0 }
  let correct = 0, wrong = 0, skipped = 0
  // Questions that cost marks, filed under their topic and Bloom's level.
  const missedBy = new Map<string, MissedQuestion[]>()
  const file = (key: string, m: MissedQuestion) => missedBy.set(key, [...(missedBy.get(key) ?? []), m])

  attempt.questions.forEach((id, index) => {
    const q = byId.get(String(id))
    if (!q) return
    const answer = attempt.answers[index]
    let o: Outcome

    if (q.type === 'coding') {
      const possible = q.points ?? room?.codingMarks ?? 10
      const mark = codingMarks.get(String(id))
      const answered = Boolean(answer && typeof answer === 'object' && String((answer as { code?: string }).code ?? '').trim())
      o = !answered ? { earned: 0, possible, result: 'skipped' }
        : mark == null ? { earned: 0, possible, result: 'pending' }
        : { earned: mark, possible, result: mark >= possible * 0.5 ? 'correct' : 'wrong' }
      coding.questions++
      coding.possible += possible
      if (o.result === 'pending') coding.pending++
      else coding.earned += o.earned
      if (o.result === 'skipped') skipped++
    } else {
      const possible = attempt.questionMarks?.[index] ?? attempt.marksPerQuestion
      o = typeof answer !== 'number' ? { earned: 0, possible, result: 'skipped' }
        : answer === q.correctIndex ? { earned: possible, possible, result: 'correct' }
        : { earned: -negative, possible, result: 'wrong' }
      mcq.questions++
      mcq.possible += possible
      mcq.earned += o.earned
      if (o.result === 'correct') correct++
      else if (o.result === 'wrong') wrong++
      else skipped++
    }

    const topic = q.topic?.trim() || (q.type === 'coding' ? 'Coding problems' : 'General')
    addTo(topics, topic.toLowerCase(), topic, o)
    if (q.bloom && q.bloom in BLOOM_INFO) {
      const info = BLOOM_INFO[q.bloom as BloomLevel]
      addTo(levels, q.bloom, `L${info.n} ${info.label}`, o)
    }

    // What went wrong, for the focus areas.
    const lost = round(o.possible - o.earned)
    if (o.result !== 'pending' && o.result !== 'correct' || (q.type === 'coding' && o.result === 'correct' && lost > 0)) {
      const option = (i: number | null | undefined) => (i == null || i < 0 || !q.options?.[i] ? null : `${String.fromCharCode(65 + i)}. ${q.options[i]}`)
      const mark = attempt.codingMarks.find(m => String(m.question) === String(id))
      const missed: MissedQuestion = q.type === 'coding'
        ? { number: index + 1, type: 'coding', text: q.title || q.text, result: o.result === 'skipped' ? 'skipped' : o.earned > 0 ? 'partial' : 'wrong', yourAnswer: null, correctAnswer: null, explanation: '', marksLost: lost, marks: { earned: round(o.earned), possible: round(o.possible) }, feedback: mark?.feedback ?? '' }
        : { number: index + 1, type: q.type === 'tf' ? 'tf' : 'mcq', text: q.text, result: o.result === 'skipped' ? 'skipped' : 'wrong', yourAnswer: typeof answer === 'number' ? option(answer) : null, correctAnswer: option(q.correctIndex), explanation: q.explanation ?? '', marksLost: lost }
      file(`t:${topic.toLowerCase()}`, missed)
      if (q.bloom && q.bloom in BLOOM_INFO) file(`l:${q.bloom}`, missed)
    }
  })

  const byTopic = [...topics.values()].map(finish).sort((a, b) => b.possible - a.possible || a.label.localeCompare(b.label))
  const byLevel = BLOOM_LEVELS.map(level => levels.get(level)).filter((b): b is Bucket => Boolean(b)).map(finish)

  // Strong and weak areas come from topics; when every question shares one topic, Bloom's levels say more.
  const graded = (list: AreaStat[]) => list.filter(a => a.possible > 0)
  const useLevels = graded(byTopic).length < 2 && graded(byLevel).length > 0
  const areas = useLevels ? graded(byLevel) : graded(byTopic)
  const strong = areas.filter(a => a.percent >= STRONG_AT).sort((a, b) => b.percent - a.percent)
  const weak = areas.filter(a => a.percent < WEAK_BELOW).sort((a, b) => a.percent - b.percent)

  // Weak areas with the exact questions missed in each (weakest first).
  const focus: FocusArea[] = weak.slice(0, 5).map(area => {
    const level = BLOOM_LEVELS.find(l => l === area.key)
    const missed = (missedBy.get(`${useLevels ? 'l' : 't'}:${area.key}`) ?? []).sort((a, b) => b.marksLost - a.marksLost)
    const wrongOnes = missed.filter(m => m.result === 'wrong').length
    const skippedOnes = missed.filter(m => m.result === 'skipped').length
    const parts = [wrongOnes && `${wrongOnes} answered wrong`, skippedOnes && `${skippedOnes} skipped`, missed.filter(m => m.result === 'partial').length && `${missed.filter(m => m.result === 'partial').length} partly solved`].filter(Boolean).join(', ')
    const advice = useLevels && level
      ? `You scored ${area.percent}% on ${area.label} questions${parts ? ` (${parts})` : ''}. ${LEVEL_TIPS[level]}`
      : `You need to improve in ${area.label}: ${area.percent}% in this test, ${area.correct} of ${area.questions} right${parts ? ` (${parts})` : ''}. Study the questions below and their explanations.`
    return { area, missed: missed.slice(0, 8), advice }
  })

  const percent = pct(attempt.score, attempt.maxScore)
  const band: ResultAnalysis['band'] = percent >= 85 ? { label: 'Excellent', tone: 'green' } : percent >= 70 ? { label: 'Good', tone: 'blue' } : percent >= 50 ? { label: 'Average', tone: 'amber' } : { label: 'Needs improvement', tone: 'red' }
  const attempted = correct + wrong
  const timeTaken = (a: { startedAt?: Date | null; submittedAt?: Date | null }) => (a.submittedAt && a.startedAt ? new Date(a.submittedAt).getTime() - new Date(a.startedAt).getTime() : Number.MAX_SAFE_INTEGER)

  // Standing: the faculty leaderboard's order (score, then time taken).
  let classStats: ResultAnalysis['classStats'] = null
  if (classmates.length > 1) {
    const ordered = [...classmates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || timeTaken(a) - timeTaken(b))
    const rank = ordered.findIndex(a => String(a._id) === String(attempt._id)) + 1
    const percents = classmates.map(a => pct(a.score ?? 0, a.maxScore ?? 0))
    const below = classmates.filter(a => (a.score ?? 0) < attempt.score).length
    classStats = {
      rank: rank || ordered.length,
      of: classmates.length,
      average: Math.round(percents.reduce((s, p) => s + p, 0) / percents.length),
      highest: Math.max(...percents),
      percentile: Math.round((below / (classmates.length - 1)) * 100),
    }
  }

  const tips: string[] = []
  for (const area of weak.slice(0, 3)) {
    const level = BLOOM_LEVELS.find(l => l === area.key)
    tips.push(level ? `${area.label}: ${LEVEL_TIPS[level]}` : `Revise ${area.label}: you scored ${area.percent}% (${area.correct} of ${area.questions} right). Go through the explanations of the questions you missed.`)
  }
  const negativeLost = round(wrong * negative)
  if (negativeLost > 0 && wrong > correct / 2) tips.push(`Guessing cost you ${negativeLost} mark${negativeLost === 1 ? '' : 's'} in negative marking. Skip questions you're unsure of when there's a penalty.`)
  if (skipped > 0 && negative === 0) tips.push(`You left ${skipped} question${skipped === 1 ? '' : 's'} unanswered. With no negative marking, an attempt can only help.`)
  if (coding.questions && !coding.pending && pct(coding.earned, coding.possible) < WEAK_BELOW) tips.push('Practise coding problems end to end: read the input format carefully and test with the sample cases before submitting.')
  if (!tips.length && percent >= STRONG_AT) tips.push('Great work. Keep practising higher-level (Analyze, Evaluate, Create) questions to stay ahead.')
  if (coding.pending) tips.push(`${coding.pending} coding answer${coding.pending === 1 ? ' is' : 's are'} still being graded, so your score may go up.`)

  return {
    percent,
    band,
    accuracy: attempted ? Math.round((correct / attempted) * 100) : null,
    attempted,
    correct,
    wrong,
    skipped,
    negativeLost,
    mcq: { earned: round(mcq.earned), possible: round(mcq.possible), questions: mcq.questions },
    coding: { earned: round(coding.earned), possible: round(coding.possible), questions: coding.questions, pending: coding.pending },
    byTopic,
    byLevel,
    strong,
    weak,
    classStats,
    timeTakenSeconds: attempt.submittedAt ? Math.round((attempt.submittedAt.getTime() - attempt.startedAt.getTime()) / 1000) : null,
    durationMinutes: room?.durationMinutes ?? 0,
    tips,
    focus,
  }
}

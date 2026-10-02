import 'server-only'
import type { Types } from 'mongoose'
import { HttpError } from './auth'
import { BLOOM_LEVELS } from './bloom'
import { evaluateCode } from './code-runs'
import { generateBatch } from './generate'
import { generateJson } from './gemini'
import { Experiment, LANGUAGES, PracticalSubject, PracticalSubmission, isObjectId } from './models'
import { normalizeQuestion } from './questions'
import { sourceFileParts, type SourceFile } from './source-files'
import { unescapeText } from './utils'

// Practicals: a lab subject (given to classes) with experiments solved in order. An experiment unlocks
// when every sample test of the one before has passed; hidden tests are graded and shown to the faculty
// but never block progress. Each experiment also has practice problems: the faculty member's pool first,
// then AI-written ones for the student who asks.

type Test = { input?: string | null; output?: string | null; explanation?: string | null }

/** The stored shape of an experiment or practice problem. */
export type ProblemDoc = {
  _id: Types.ObjectId
  title: string
  text: string
  inputFormat?: string | null
  outputFormat?: string | null
  constraints?: string | null
  samples?: Test[] | null
  hiddenTests?: Test[] | null
  topic?: string | null
  language?: string | null
  starterCode?: string | null
}

/** Cleans a problem from a request body (same rules as a coding question). Throws 400 when unusable. */
export function problemInput(raw: Record<string, unknown>) {
  const result = normalizeQuestion({ ...raw, type: 'coding' })
  if (typeof result === 'string') throw new HttpError(400, `This problem ${result}.`)
  if (!result.title.trim()) throw new HttpError(400, 'Give the problem a title.')
  if (!result.samples.length) throw new HttpError(400, 'Add at least one sample test: students unlock the next experiment by passing them.')
  const { title, text, inputFormat, outputFormat, constraints, samples, hiddenTests, topic, language, starterCode } = result
  return { title, text, inputFormat, outputFormat, constraints, samples, hiddenTests, topic, language, starterCode }
}

// Problems saved before escaped line breaks were cleaned up on input are fixed on the way out (and before grading).
const tests = (list: Test[] | null | undefined) => (list ?? []).map(t => ({ input: unescapeText(t.input ?? ''), output: unescapeText(t.output ?? ''), explanation: unescapeText(t.explanation ?? '') }))

/**
 * A problem for the client. Faculty get the hidden tests; students only learn how many there are.
 */
export function serializeProblem(p: ProblemDoc, { withHidden }: { withHidden: boolean }) {
  return {
    id: String(p._id),
    title: p.title,
    text: unescapeText(p.text),
    inputFormat: unescapeText(p.inputFormat ?? ''),
    outputFormat: unescapeText(p.outputFormat ?? ''),
    constraints: unescapeText(p.constraints ?? ''),
    samples: tests(p.samples),
    ...(withHidden ? { hiddenTests: tests(p.hiddenTests) } : {}),
    hiddenCount: p.hiddenTests?.length ?? 0,
    topic: p.topic ?? '',
    language: p.language ?? '',
    starterCode: p.starterCode ?? '',
  }
}

export async function findTeacherSubject(teacherId: Types.ObjectId, id: string) {
  if (!isObjectId(id)) throw new HttpError(404, 'Practical not found.')
  const subject = await PracticalSubject.findOne({ _id: id, teacher: teacherId })
  if (!subject) throw new HttpError(404, 'Practical not found.')
  return subject
}

export async function findSubjectExperiment(subjectId: Types.ObjectId, id: string) {
  if (!isObjectId(id)) throw new HttpError(404, 'Experiment not found.')
  const experiment = await Experiment.findOne({ _id: id, subject: subjectId })
  if (!experiment) throw new HttpError(404, 'Experiment not found.')
  return experiment
}

/** A practical the student's class takes. */
export async function findStudentSubject(student: { classroom?: { _id: unknown } | null }, id: string) {
  if (!isObjectId(id) || !student.classroom) throw new HttpError(404, 'Practical not found.')
  const subject = await PracticalSubject.findOne({ _id: id, classrooms: student.classroom._id as Types.ObjectId }).lean()
  if (!subject) throw new HttpError(404, 'Practical not found.')
  return subject
}

/** Ids of the experiments this student has solved (every sample passed) in a subject. */
export async function solvedExperiments(subjectId: Types.ObjectId, studentId: Types.ObjectId) {
  const ids = await PracticalSubmission.distinct('experiment', { subject: subjectId, student: studentId, problem: null, solved: true })
  return new Set(ids.map(String))
}

/** Experiments in order, each with whether it's solved and whether it's open (every earlier one solved). */
export function levels<T extends { _id: Types.ObjectId }>(experiments: T[], solved: Set<string>) {
  let open = true
  return experiments.map(experiment => {
    const isSolved = solved.has(String(experiment._id))
    const status: 'solved' | 'open' | 'locked' = isSolved ? 'solved' : open ? 'open' : 'locked'
    if (!isSolved) open = false
    return { experiment, status }
  })
}

/** The context generateProblem needs for a subject: its details and current experiments. */
export async function practicalContext(subject: { _id: Types.ObjectId; title: string; code?: string | null; description?: string | null }): Promise<PracticalContext> {
  const experiments = await Experiment.find({ subject: subject._id }).select('title order').sort({ order: 1 }).lean()
  return { subject, experiments }
}

/** Throws unless the student may work on this experiment (it's solved or the next one to solve). */
export async function assertUnlocked(subjectId: Types.ObjectId, experimentId: Types.ObjectId, studentId: Types.ObjectId) {
  const status = await experimentStatus(subjectId, experimentId, studentId)
  if (status === 'locked') throw new HttpError(403, 'Solve the earlier experiments first. Each one unlocks when all its sample tests pass.')
  return status
}

/** Whether this experiment is solved, open (the next one to solve) or locked for the student. Locked ones can be read, not solved. */
export async function experimentStatus(subjectId: Types.ObjectId, experimentId: Types.ObjectId, studentId: Types.ObjectId) {
  const experiments = await Experiment.find({ subject: subjectId }).select('_id order title').sort({ order: 1 }).lean()
  const level = levels(experiments, await solvedExperiments(subjectId, studentId)).find(l => String(l.experiment._id) === String(experimentId))
  if (!level) throw new HttpError(404, 'Experiment not found.')
  return level.status
}

/**
 * Runs a submission on the server: samples first, then hidden tests. Students see every sample result in
 * full but only the number of hidden tests passed, never their inputs or outputs.
 */
export async function gradeProblem(problem: ProblemDoc, language: string, code: string) {
  if (!(LANGUAGES as readonly string[]).includes(language)) throw new HttpError(400, 'Choose a supported language.')
  if (!code.trim()) throw new HttpError(400, 'Write some code first.')
  if (code.length > 50_000) throw new HttpError(400, 'The code is too long (50,000 characters at most).')
  const samples = tests(problem.samples)
  const hidden = tests(problem.hiddenTests)
  const cases = [...samples, ...hidden].map(t => ({ input: t.input, expectedOutput: t.output }))
  if (!cases.length) throw new HttpError(400, 'This problem has no tests yet. Ask your faculty to add them.')
  let result: Awaited<ReturnType<typeof evaluateCode>>
  try {
    result = await evaluateCode(language, code, cases)
  } catch {
    throw new HttpError(503, 'The code runner is not available right now. Please try again in a minute.')
  }
  const results = result.testResults ?? []
  const sampleResults = results.slice(0, samples.length)
  const samplesPassed = sampleResults.filter(r => r.passed).length
  const hiddenPassed = results.slice(samples.length).filter(r => r.passed).length
  return {
    samplesPassed,
    samplesTotal: samples.length,
    hiddenPassed,
    hiddenTotal: hidden.length,
    solved: samples.length > 0 && samplesPassed === samples.length,
    compileError: result.compileError ?? '',
    sampleResults,
  }
}

/** How hard an AI-written problem should be. */
export const PROBLEM_LEVELS = ['easy', 'medium', 'hard'] as const
export type ProblemLevel = (typeof PROBLEM_LEVELS)[number]
const LEVEL_GUIDE: Record<ProblemLevel, string> = {
  easy: 'EASY: a direct application of the concept for a student meeting it for the first time; small inputs, one or two steps, no tricky edge cases beyond the obvious.',
  medium: 'MEDIUM: needs the concept plus some reasoning (a loop or two, a helper function, a couple of edge cases such as empty input or duplicates), like a typical lab exercise.',
  hard: 'HARD: combines the concept with careful handling of edge cases and larger inputs within the constraints, so an efficient approach matters; still solvable in a lab session.',
}
export const parseLevel = (value: unknown): ProblemLevel => ((PROBLEM_LEVELS as readonly string[]).includes(String(value)) ? (value as ProblemLevel) : 'medium')

/** What the AI knows about the practical a problem belongs to, so it fits the subject and the sequence. */
export type PracticalContext = { subject: { title: string; code?: string | null; description?: string | null }; experiments: { order: number; title: string }[] }

/** The practical's context, as a prompt section. */
function contextText({ subject, experiments }: PracticalContext) {
  return [
    `This is for the college practical (lab) subject "${subject.title}"${subject.code ? ` (${subject.code})` : ''}.`,
    subject.description ? `Subject description: ${subject.description.slice(0, 1500)}` : '',
    experiments.length ? `Its experiments so far, in order:\n${experiments.slice(0, 60).map(e => `${e.order}. ${e.title}`).join('\n')}` : '',
  ].filter(Boolean).join('\n')
}

/**
 * Asks the AI for one coding problem: a new experiment for the practical (from a topic and the faculty
 * member's instructions), or, with `like`, a practice problem on the same concept as that experiment.
 * The practical's subject and existing experiments are given as context; `level` sets the difficulty.
 */
export async function generateProblem({ topic, description, level = 'medium', context, like, avoid = [] }: {
  topic: string
  description?: string
  level?: ProblemLevel
  context?: PracticalContext
  like?: ProblemDoc
  avoid?: string[]
}) {
  const brief = [
    context ? contextText(context) : '',
    like
      ? `Write a NEW practice problem that exercises the same concept as this experiment, with a different scenario and different data:\nTitle: ${like.title}\nStatement: ${like.text.slice(0, 2000)}`
      : 'Write one lab experiment as a coding problem. It must fit this subject and not repeat an existing experiment.',
    `Difficulty: ${LEVEL_GUIDE[level]}`,
    avoid.length ? `It must differ from these existing problems: ${avoid.slice(0, 40).join('; ')}.` : '',
    description ? `Faculty instructions:\n"""\n${description.slice(0, 3000)}\n"""` : '',
  ].filter(Boolean).join('\n\n')
  const { coding } = await generateBatch({
    topic, description: brief, sourceText: '', files: [], levels: BLOOM_LEVELS.map(() => 0), singleLevel: level === 'easy' ? 'apply' : level === 'medium' ? 'analyze' : 'create',
    codingCount: 1, sets: 1, part: 1, partCount: 1,
  })
  const problem = coding[0]
  if (!problem || !problem.samples.length) throw new HttpError(502, 'The AI did not return a usable problem. Please try again.')
  const { title, text, inputFormat, outputFormat, constraints, samples, hiddenTests, language, starterCode } = problem
  return { title, text, inputFormat, outputFormat, constraints, samples, hiddenTests, topic: problem.topic || topic, language, starterCode }
}

/** The AI writes an experiment from a topic and instructions and adds it as the practical's last one. */
export async function addGeneratedExperiment(subject: { _id: Types.ObjectId; title: string; code?: string | null; description?: string | null }, teacherId: Types.ObjectId, { topic, description, level }: { topic: string; description: string; level: ProblemLevel }) {
  const ctx = await practicalContext(subject)
  const problem = await generateProblem({ topic, description, level, context: ctx, avoid: ctx.experiments.map(e => e.title) })
  const last = await Experiment.findOne({ subject: subject._id }).sort({ order: -1 }).select('order').lean()
  return Experiment.create({ ...problem, subject: subject._id, teacher: teacherId, order: (last?.order ?? 0) + 1 })
}

/**
 * Reads a practical list (a scanned or typed page, PDF or Word file) and returns its experiments in order:
 * a short title and the aim as written. Nothing is saved.
 */
export async function extractPracticalList(files: SourceFile[]) {
  const parts: Parameters<typeof generateJson>[0]['parts'] = [...(await sourceFileParts(files))]
  parts.push({
    text: [
      'These files contain the list of practicals (lab experiments) for a college subject, possibly as a photo or scan.',
      'List every experiment in the order given. For each: "title" is a short name for it (at most 10 words, e.g. "Stack using arrays"); "aim" is the full aim or problem statement as written, with obvious typos fixed.',
      'Skip headings, instructions, dates, signatures, marks columns and anything that is not an experiment. If the list numbers its items, keep that order.',
      'If an item asks for several programs, keep it as one experiment and include all of them in its aim.',
    ].join('\n'),
  })
  const result = await generateJson<{ experiments?: { title?: string; aim?: string }[] }>({
    system: 'You read lab manuals and syllabus documents accurately and extract structured lists from them.',
    parts,
    schema: {
      type: 'OBJECT',
      properties: { experiments: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, aim: { type: 'STRING' } }, required: ['title', 'aim'] } } },
      required: ['experiments'],
    },
  })
  const experiments = (result.experiments ?? [])
    .map(e => ({ title: String(e.title ?? '').trim().slice(0, 150), aim: String(e.aim ?? '').trim().slice(0, 3000) }))
    .filter(e => e.title || e.aim)
    .slice(0, 60)
  if (!experiments.length) throw new HttpError(422, "We couldn't find a list of experiments in that file. Try a clearer photo or another file.")
  return experiments
}

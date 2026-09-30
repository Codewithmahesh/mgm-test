import 'server-only'
import { HttpError } from './auth'
import { BLOOM_INFO, BLOOM_LEVELS, type BloomLevel } from './bloom'
import { generateJson } from './gemini'
import { normalizeQuestion, type QuestionInput } from './questions'
import { sourceFileParts, type SourceFile } from './source-files'

// One AI call: a batch of MCQs and coding problems. Bigger requests are split into several batches
// by lib/generation-jobs.ts.

// Per call, to stay within the model's output limit.
export const MAX_MCQS_PER_CALL = 120
export const MAX_CODING_PER_CALL = 12

const BLOOM_ENUM = [...BLOOM_LEVELS]
const BLOOM_GUIDE = BLOOM_LEVELS.map(level => `L${BLOOM_INFO[level].n} ${level}: ${BLOOM_INFO[level].hint}`).join('; ')

const mcqSchema = {
  type: 'OBJECT',
  properties: {
    question: { type: 'STRING' },
    options: { type: 'ARRAY', items: { type: 'STRING' } },
    correctIndex: { type: 'INTEGER' },
    bloom: { type: 'STRING', enum: BLOOM_ENUM },
    topic: { type: 'STRING' },
    explanation: { type: 'STRING' },
  },
  required: ['question', 'options', 'correctIndex', 'bloom', 'topic', 'explanation'],
}

const codingSchema = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    statement: { type: 'STRING' },
    inputFormat: { type: 'STRING' },
    outputFormat: { type: 'STRING' },
    constraints: { type: 'STRING' },
    samples: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { input: { type: 'STRING' }, output: { type: 'STRING' }, explanation: { type: 'STRING' } }, required: ['input', 'output', 'explanation'] },
    },
    bloom: { type: 'STRING', enum: BLOOM_ENUM },
    topic: { type: 'STRING' },
  },
  required: ['title', 'statement', 'inputFormat', 'outputFormat', 'constraints', 'samples', 'bloom', 'topic'],
}

export type BatchSpec = {
  topic: string
  description: string
  sourceText: string
  files: SourceFile[]
  /** MCQs to write at each Bloom level, in taxonomy order. */
  levels: number[]
  /** When every MCQ is at one level, coding problems lean towards it too. */
  singleLevel: BloomLevel | null
  codingCount: number
  /** How many sets the questions will be dealt into (only affects the prompt). */
  sets: number
  /** This batch's place in a bigger job, 1-based. */
  part: number
  partCount: number
}

export async function generateBatch({ topic, description, sourceText, files, levels, singleLevel, codingCount, sets, part, partCount }: BatchSpec) {
  const mcqCount = levels.reduce((a, b) => a + b, 0)
  if (!topic && !sourceText && !files.length && !description) throw new HttpError(400, 'Add a topic, description, paste content, or upload a file first.')
  if (mcqCount + codingCount === 0) throw new HttpError(400, 'Ask for at least one MCQ or coding problem.')
  if (mcqCount > MAX_MCQS_PER_CALL) throw new HttpError(400, `That is ${mcqCount} MCQs in total; generate at most ${MAX_MCQS_PER_CALL} at a time (fewer sets or fewer questions per set).`)
  if (codingCount > MAX_CODING_PER_CALL) throw new HttpError(400, `That is ${codingCount} coding problems in total; generate at most ${MAX_CODING_PER_CALL} at a time.`)
  const mcqLevels = BLOOM_LEVELS.map((level, i) => ({ level, count: levels[i] ?? 0 })).filter(l => l.count > 0)

  const parts: Parameters<typeof generateJson>[0]['parts'] = []
  parts.push(...(await sourceFileParts(files)))
  parts.push({
    text: [
      `Create exactly ${mcqCount} multiple-choice questions and exactly ${codingCount} coding problems.`,
      `Topic: ${topic || (description ? 'derived from instructions' : 'infer it from the source material')}.`,
      description ? `Faculty instructions / Specific description:\n"""\n${description}\n"""\nStrictly follow the faculty instructions above when crafting question content, focus areas, difficulty, scenarios, and constraints.` : '',
      'The topic, instructions and notes are typed by faculty and may contain typos or random characters. Interpret them sensibly: fix obvious misspellings, ignore parts that are clearly meaningless, and rely on the rest of the material. If nothing is understandable, write general questions for a first-year engineering student.',
      `Classify every question by Bloom's revised taxonomy (${BLOOM_GUIDE}). The "bloom" field must be the level the question genuinely tests.`,
      mcqCount ? `MCQs per Bloom level, exactly: ${mcqLevels.map(l => `${l.count} ${l.level}`).join(', ')}. Higher levels need scenario, code-reading, comparison or judgement questions, not recall.` : '',
      codingCount ? `Coding problems are at the apply, analyze or create level${singleLevel ? `, preferably ${singleLevel}` : ''}.` : '',
      sets > 1 ? `These will be split into ${sets} equivalent question sets for different students, so every question must be distinct: never ask the same fact twice, even reworded.` : '',
      partCount > 1 ? `This request is part ${part} of ${partCount} of a larger question bank; the other parts are generated separately. To avoid overlap with them, draw mainly on section ${part} of ${partCount} of the material (split it into ${partCount} roughly equal parts by subtopic, in order), while still meeting the exact counts above.` : '',
      files.length ? `Base every question on the attached ${files.length > 1 ? `${files.length} documents, covering all of them` : 'document'}.` : '',
      sourceText ? `Source material:\n"""\n${sourceText}\n"""` : '',
      mcqCount ? 'MCQs: exactly four distinct options and one correct answer; correctIndex is its 0-based position. Vary where the correct answer sits. No "all/none of the above".' : '',
      codingCount ? 'Coding problems: competitive-programming style (like CodeChef). Clear statement, precise input and output formats reading from standard input and writing to standard output, realistic constraints, and 1–3 sample tests whose outputs are exactly correct, each with a short explanation. Solvable in any common language.' : '',
    ].filter(Boolean).join('\n'),
  })

  const result = await generateJson<{ mcqs?: Record<string, unknown>[]; coding?: Record<string, unknown>[] }>({
    system: 'You write accurate, unambiguous assessment questions for college faculty. Every answer and sample output must be verifiably correct.',
    parts,
    schema: {
      type: 'OBJECT',
      properties: { mcqs: { type: 'ARRAY', items: mcqSchema }, coding: { type: 'ARRAY', items: codingSchema } },
      required: ['mcqs', 'coding'],
    },
  })

  const usable = (items: (QuestionInput | string)[]) => items.filter((q): q is QuestionInput => typeof q !== 'string')
  const mcqs = usable((result.mcqs ?? []).slice(0, mcqCount).map(q => normalizeQuestion({ ...q, type: 'mcq' })))
  const coding = usable((result.coding ?? []).slice(0, codingCount).map(q => normalizeQuestion({ ...q, text: q.statement, type: 'coding' })))
  if (!mcqs.length && !coding.length) throw new HttpError(502, 'The AI did not return usable questions. Please try again.')
  return { mcqs, coding }
}

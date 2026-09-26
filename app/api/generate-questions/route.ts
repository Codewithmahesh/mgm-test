import { NextResponse } from 'next/server'
import { HttpError, handler, rateLimit, requireTeacher } from '@/lib/auth'
import { proportionalQuotas } from '@/lib/exams'
import { generateJson } from '@/lib/gemini'
import { normalizeQuestion, type QuestionInput } from '@/lib/questions'

export const maxDuration = 300

// Vercel caps request bodies at 4.5 MB, so uploads must stay under that.
const MAX_PDF_BYTES = 4 * 1024 * 1024
const MAX_MCQS = 120
const MAX_CODING = 12
const LEVELS = ['easy', 'medium', 'hard'] as const
// "Mixed" papers: 30% easy, 40% medium, 30% hard.
const MIXED_RATIO = [3, 4, 3]

const mcqSchema = {
  type: 'OBJECT',
  properties: {
    question: { type: 'STRING' },
    options: { type: 'ARRAY', items: { type: 'STRING' } },
    correctIndex: { type: 'INTEGER' },
    difficulty: { type: 'STRING', enum: ['easy', 'medium', 'hard'] },
    topic: { type: 'STRING' },
    explanation: { type: 'STRING' },
  },
  required: ['question', 'options', 'correctIndex', 'difficulty', 'topic', 'explanation'],
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
    difficulty: { type: 'STRING', enum: ['easy', 'medium', 'hard'] },
    topic: { type: 'STRING' },
  },
  required: ['title', 'statement', 'inputFormat', 'outputFormat', 'constraints', 'samples', 'difficulty', 'topic'],
}

/**
 * POST /api/generate-questions (multipart form or JSON)
 * Fields: topic, sourceText, pdf (file), mcqCount and codingCount (per set), sets (1-6),
 * difficulty (easy | medium | hard | mixed | custom) and, for custom, easy/medium/hard MCQ counts per set.
 * With sets > 1 the questions come back labelled A, B, C..., every set with the same difficulty mix.
 * Returns questions for review; nothing is saved.
 */
export const POST = handler(async (request: Request) => {
  const teacher = await requireTeacher()
  await rateLimit(`ai:teacher:${teacher._id}`, 40, 60 * 60)

  const fields = await readFields(request)
  const topic = fields.topic.slice(0, 300)
  const sourceText = fields.sourceText.slice(0, 80_000)
  const sets = clamp(fields.sets, 1, 6) || 1
  const difficulty = ['easy', 'medium', 'hard', 'custom'].includes(fields.difficulty) ? fields.difficulty : 'mixed'

  // MCQs per set, split by difficulty: [easy, medium, hard].
  let perSet: number[]
  if (difficulty === 'custom') perSet = LEVELS.map(level => clamp(fields[level], 0, MAX_MCQS))
  else {
    const count = clamp(fields.mcqCount ?? fields.count, 0, MAX_MCQS)
    perSet = difficulty === 'mixed' ? proportionalQuotas(MIXED_RATIO, count) : LEVELS.map(level => (level === difficulty ? count : 0))
  }
  const mcqCount = perSet.reduce((a, b) => a + b, 0) * sets
  const codingCount = clamp(fields.codingCount, 0, MAX_CODING) * sets

  if (!topic && !sourceText && !fields.pdf) throw new HttpError(400, 'Add a topic, paste content, or upload a PDF first.')
  if (mcqCount + codingCount === 0) throw new HttpError(400, 'Ask for at least one MCQ or coding problem.')
  if (mcqCount > MAX_MCQS) throw new HttpError(400, `That is ${mcqCount} MCQs in total; generate at most ${MAX_MCQS} at a time (fewer sets or fewer questions per set).`)
  if (codingCount > MAX_CODING) throw new HttpError(400, `That is ${codingCount} coding problems in total; generate at most ${MAX_CODING} at a time.`)
  const mcqLevels = LEVELS.map((level, i) => ({ level, count: perSet[i] * sets })).filter(l => l.count > 0)

  const parts: Parameters<typeof generateJson>[0]['parts'] = []
  if (fields.pdf) parts.push({ inline_data: { mime_type: 'application/pdf', data: Buffer.from(await fields.pdf.arrayBuffer()).toString('base64') } })
  parts.push({
    text: [
      `Create exactly ${mcqCount} multiple-choice questions and exactly ${codingCount} coding problems.`,
      `Topic: ${topic || 'infer it from the source material'}.`,
      mcqCount ? `MCQ difficulty, exactly: ${mcqLevels.map(l => `${l.count} ${l.level}`).join(', ')}. Label each MCQ's difficulty truthfully: easy = direct recall, medium = applying a concept, hard = multi-step reasoning or analysis.` : '',
      codingCount ? `Coding difficulty: ${difficulty === 'mixed' || difficulty === 'custom' ? 'a balanced mix of easy, medium and hard' : difficulty}.` : '',
      sets > 1 ? `These will be split into ${sets} equivalent question sets for different students, so every question must be distinct: never ask the same fact twice, even reworded.` : '',
      fields.pdf ? 'Base every question on the attached PDF.' : '',
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
  const questions = sets > 1 ? [...splitIntoSets(mcqs, sets), ...splitIntoSets(coding, sets)] : [...mcqs, ...coding]
  return NextResponse.json({ questions, sets: sets > 1 ? Array.from({ length: sets }, (_, i) => setName(i)) : [] })
})

const setName = (index: number) => String.fromCharCode(65 + index)

/**
 * Deals questions into sets A, B, C... difficulty by difficulty (easy first, then medium, hard,
 * unrated), continuing the rotation across difficulties. Every set ends up with the same number of
 * questions of each difficulty (give or take one when the counts don't divide evenly).
 */
function splitIntoSets(questions: QuestionInput[], sets: number) {
  const order = (q: QuestionInput) => (q.difficulty ? LEVELS.indexOf(q.difficulty) : LEVELS.length)
  const sorted = questions.map((q, i) => ({ q, i })).sort((a, b) => order(a.q) - order(b.q) || a.i - b.i)
  return sorted.map(({ q }, i) => ({ ...q, set: setName(i % sets) })).sort((a, b) => a.set.localeCompare(b.set))
}

function clamp(value: string | undefined, min: number, max: number) {
  const number = Math.round(Number(value))
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min
}

async function readFields(request: Request) {
  const type = request.headers.get('content-type') ?? ''
  if (type.includes('multipart/form-data')) {
    const form = await request.formData()
    const file = form.get('pdf')
    const pdf = file instanceof File && file.size > 0 ? file : null
    if (pdf && pdf.type !== 'application/pdf') throw new HttpError(400, 'Only PDF files are supported.')
    if (pdf && pdf.size > MAX_PDF_BYTES) throw new HttpError(413, 'The PDF is larger than 4 MB. Split it or compress it and try again.')
    const text = (name: string) => (form.has(name) ? String(form.get(name) ?? '').trim() : undefined)
    return { ...commonFields(text), pdf }
  }
  const body = await request.json().catch(() => ({}))
  const text = (name: string) => (body[name] === undefined ? undefined : String(body[name]).trim())
  return { ...commonFields(text), pdf: null as File | null }
}

function commonFields(text: (name: string) => string | undefined) {
  return {
    topic: text('topic') ?? '', sourceText: text('sourceText') ?? '', difficulty: text('difficulty') ?? '',
    count: text('count'), mcqCount: text('mcqCount'), codingCount: text('codingCount'), sets: text('sets'),
    easy: text('easy'), medium: text('medium'), hard: text('hard'),
  }
}

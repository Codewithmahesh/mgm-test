import { NextResponse } from 'next/server'
import { HttpError, handler, rateLimit, requireTeacher } from '@/lib/auth'
import { BLOOM_INFO, BLOOM_LEVELS, setName, splitByShares } from '@/lib/bloom'
import { generateJson } from '@/lib/gemini'
import { normalizeQuestion, toDraft, type QuestionInput } from '@/lib/questions'

export const maxDuration = 300

// Vercel caps request bodies at 4.5 MB, so uploads must stay under that.
const MAX_PDF_BYTES = 4 * 1024 * 1024
const MAX_MCQS = 120
const MAX_CODING = 12
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

/**
 * POST /api/generate-questions (multipart form or JSON)
 * Fields: topic, sourceText, pdf (file), mcqCount and codingCount (per set), sets (1-10),
 * bloomMode (mixed | custom | one Bloom level) and, for custom, remember/understand/apply/analyze/
 * evaluate/create MCQ counts per set. With sets > 1 the questions come back labelled A, B, C…,
 * every set with the same count per Bloom level.
 * Returns questions for review; nothing is saved.
 */
export const POST = handler(async (request: Request) => {
  const teacher = await requireTeacher()
  await rateLimit(`ai:teacher:${teacher._id}`, 40, 60 * 60)

  const fields = await readFields(request)
  const topic = fields.topic.slice(0, 300)
  const description = fields.description.slice(0, 3000)
  const sourceText = fields.sourceText.slice(0, 80_000)
  const sets = clamp(fields.sets, 1, 10) || 1
  const mode = fields.bloomMode === 'custom' || (BLOOM_LEVELS as readonly string[]).includes(fields.bloomMode) ? fields.bloomMode : 'mixed'

  // MCQs per set at each Bloom level, in taxonomy order.
  let perSet: number[]
  if (mode === 'custom') perSet = BLOOM_LEVELS.map(level => clamp(fields.levels[level], 0, MAX_MCQS))
  else {
    const count = clamp(fields.mcqCount ?? fields.count, 0, MAX_MCQS)
    perSet = mode === 'mixed' ? splitByShares(count) : BLOOM_LEVELS.map(level => (level === mode ? count : 0))
  }
  const mcqCount = perSet.reduce((a, b) => a + b, 0) * sets
  const codingCount = clamp(fields.codingCount, 0, MAX_CODING) * sets

  if (!topic && !sourceText && !fields.pdf && !description) throw new HttpError(400, 'Add a topic, description, paste content, or upload a PDF first.')
  if (mcqCount + codingCount === 0) throw new HttpError(400, 'Ask for at least one MCQ or coding problem.')
  if (mcqCount > MAX_MCQS) throw new HttpError(400, `That is ${mcqCount} MCQs in total; generate at most ${MAX_MCQS} at a time (fewer sets or fewer questions per set).`)
  if (codingCount > MAX_CODING) throw new HttpError(400, `That is ${codingCount} coding problems in total; generate at most ${MAX_CODING} at a time.`)
  const mcqLevels = BLOOM_LEVELS.map((level, i) => ({ level, count: perSet[i] * sets })).filter(l => l.count > 0)

  const parts: Parameters<typeof generateJson>[0]['parts'] = []
  if (fields.pdf) parts.push({ inline_data: { mime_type: 'application/pdf', data: Buffer.from(await fields.pdf.arrayBuffer()).toString('base64') } })
  parts.push({
    text: [
      `Create exactly ${mcqCount} multiple-choice questions and exactly ${codingCount} coding problems.`,
      `Topic: ${topic || (description ? 'derived from instructions' : 'infer it from the source material')}.`,
      description ? `Faculty instructions / Specific description:\n"""\n${description}\n"""\nStrictly follow the faculty instructions above when crafting question content, focus areas, difficulty, scenarios, and constraints.` : '',
      `Classify every question by Bloom's revised taxonomy (${BLOOM_GUIDE}). The "bloom" field must be the level the question genuinely tests.`,
      mcqCount ? `MCQs per Bloom level, exactly: ${mcqLevels.map(l => `${l.count} ${l.level}`).join(', ')}. Higher levels need scenario, code-reading, comparison or judgement questions, not recall.` : '',
      codingCount ? `Coding problems are at the apply, analyze or create level${mode !== 'mixed' && mode !== 'custom' ? `, preferably ${mode}` : ''}.` : '',
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
  return NextResponse.json({ questions: questions.map(toDraft), sets: sets > 1 ? Array.from({ length: sets }, (_, i) => setName(i)) : [] })
})

/**
 * Deals questions into sets A, B, C… level by level (Remember first, then Understand, … Create,
 * then unlabelled), continuing the rotation across levels. Every set ends up with the same number
 * of questions at each Bloom level (give or take one when the counts don't divide evenly).
 */
function splitIntoSets(questions: QuestionInput[], sets: number) {
  const order = (q: QuestionInput) => (q.bloom ? BLOOM_LEVELS.indexOf(q.bloom) : BLOOM_LEVELS.length)
  const sorted = questions.map((q, i) => ({ q, i })).sort((a, b) => order(a.q) - order(b.q) || a.i - b.i)
  return sorted.map(({ q }, i) => ({ ...q, setLabel: setName(i % sets) })).sort((a, b) => a.setLabel.localeCompare(b.setLabel))
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
    topic: text('topic') ?? '', description: text('description') ?? '', sourceText: text('sourceText') ?? '', bloomMode: text('bloomMode') ?? '',
    count: text('count'), mcqCount: text('mcqCount'), codingCount: text('codingCount'), sets: text('sets'),
    levels: Object.fromEntries(BLOOM_LEVELS.map(level => [level, text(level)])) as Record<string, string | undefined>,
  }
}

import { NextResponse } from 'next/server'
import { HttpError, handler, rateLimit, requireTeacher } from '@/lib/auth'
import { generateJson } from '@/lib/gemini'
import { normalizeQuestion, type QuestionInput } from '@/lib/questions'

export const maxDuration = 180

// Vercel caps request bodies at 4.5 MB, so uploads must stay under that.
const MAX_PDF_BYTES = 4 * 1024 * 1024

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
 * Fields: topic, sourceText, difficulty, mcqCount, codingCount, pdf (file).
 * Returns questions for review; nothing is saved.
 */
export const POST = handler(async (request: Request) => {
  const teacher = await requireTeacher()
  await rateLimit(`ai:teacher:${teacher._id}`, 40, 60 * 60)

  const fields = await readFields(request)
  const topic = fields.topic.slice(0, 300)
  const sourceText = fields.sourceText.slice(0, 80_000)
  const mcqCount = clamp(fields.mcqCount ?? fields.count, 0, 60)
  const codingCount = clamp(fields.codingCount, 0, 10)
  const difficulty = ['easy', 'medium', 'hard'].includes(fields.difficulty) ? fields.difficulty : 'mixed'

  if (!topic && !sourceText && !fields.pdf) throw new HttpError(400, 'Add a topic, paste content, or upload a PDF first.')
  if (mcqCount + codingCount === 0) throw new HttpError(400, 'Ask for at least one MCQ or coding problem.')

  const parts: Parameters<typeof generateJson>[0]['parts'] = []
  if (fields.pdf) parts.push({ inline_data: { mime_type: 'application/pdf', data: Buffer.from(await fields.pdf.arrayBuffer()).toString('base64') } })
  parts.push({
    text: [
      `Create exactly ${mcqCount} multiple-choice questions and exactly ${codingCount} coding problems.`,
      `Topic: ${topic || 'infer it from the source material'}.`,
      `Difficulty: ${difficulty === 'mixed' ? 'a balanced mix of easy, medium and hard' : difficulty}.`,
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

  const questions = [
    ...(result.mcqs ?? []).slice(0, mcqCount).map(q => normalizeQuestion({ ...q, type: 'mcq' })),
    ...(result.coding ?? []).slice(0, codingCount).map(q => normalizeQuestion({ ...q, text: q.statement, type: 'coding' })),
  ].filter((q): q is QuestionInput => typeof q !== 'string')
  if (!questions.length) throw new HttpError(502, 'The AI did not return usable questions. Please try again.')
  return NextResponse.json({ questions })
})

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
    return { topic: text('topic') ?? '', sourceText: text('sourceText') ?? '', count: text('count'), mcqCount: text('mcqCount'), codingCount: text('codingCount'), difficulty: text('difficulty') ?? '', pdf }
  }
  const body = await request.json().catch(() => ({}))
  const text = (name: string) => (body[name] === undefined ? undefined : String(body[name]).trim())
  return { topic: text('topic') ?? '', sourceText: text('sourceText') ?? '', count: text('count'), mcqCount: text('mcqCount'), codingCount: text('codingCount'), difficulty: text('difficulty') ?? '', pdf: null as File | null }
}

import { NextResponse } from 'next/server'
import { handler, rateLimit, requireTeacher } from '@/lib/auth'
import { BLOOM_LEVELS, dealIntoSets, setName, splitByShares, type BloomLevel } from '@/lib/bloom'
import { MAX_CODING_PER_CALL, MAX_MCQS_PER_CALL, MAX_TF_PER_CALL, generateBatch } from '@/lib/generate'
import { toDraft, type QuestionInput } from '@/lib/questions'
import { readSourceFiles, type SourceFile } from '@/lib/source-files'

export const maxDuration = 300

const MAX_SETS = 20

/**
 * POST /api/generate-questions (multipart form or JSON) — one AI call, answered directly.
 * The faculty UI uses /api/generation-jobs instead, which splits big requests and can run in the background.
 * Fields: topic, sourceText, files (PDF, .doc, .docx or .tex; repeatable), mcqCount, tfCount and codingCount (per set), sets (1-20),
 * bloomMode (mixed | custom | one Bloom level) and, for custom, remember/understand/apply/analyze/
 * evaluate/create MCQ counts per set. With sets > 1 the questions come back labelled A, B, C…,
 * every set with the same count per Bloom level.
 * Returns questions for review; nothing is saved.
 */
export const POST = handler(async (request: Request) => {
  const teacher = await requireTeacher()
  await rateLimit(`ai:teacher:${teacher._id}`, 300, 60 * 60)

  const fields = await readFields(request)
  const sets = clamp(fields.sets, 1, MAX_SETS) || 1
  const mode = fields.bloomMode === 'custom' || (BLOOM_LEVELS as readonly string[]).includes(fields.bloomMode) ? fields.bloomMode : 'mixed'

  // MCQs per set at each Bloom level, in taxonomy order.
  let perSet: number[]
  if (mode === 'custom') perSet = BLOOM_LEVELS.map(level => clamp(fields.levels[level], 0, MAX_MCQS_PER_CALL))
  else {
    const count = clamp(fields.mcqCount ?? fields.count, 0, MAX_MCQS_PER_CALL)
    perSet = mode === 'mixed' ? splitByShares(count) : BLOOM_LEVELS.map(level => (level === mode ? count : 0))
  }

  const { mcqs, trueFalse, coding } = await generateBatch({
    topic: fields.topic.slice(0, 300),
    description: fields.description.slice(0, 3000),
    sourceText: fields.sourceText.slice(0, 80_000),
    files: fields.files,
    levels: perSet.map(n => n * sets),
    singleLevel: mode !== 'mixed' && mode !== 'custom' ? (mode as BloomLevel) : null,
    tfCount: clamp(fields.tfCount, 0, MAX_TF_PER_CALL) * sets,
    codingCount: clamp(fields.codingCount, 0, MAX_CODING_PER_CALL) * sets,
    sets,
    part: 1,
    partCount: 1,
  })
  const questions = sets > 1 ? [...splitIntoSets(mcqs, sets), ...splitIntoSets(trueFalse, sets), ...splitIntoSets(coding, sets)] : [...mcqs, ...trueFalse, ...coding]
  return NextResponse.json({ questions: questions.map(toDraft), sets: sets > 1 ? Array.from({ length: sets }, (_, i) => setName(i)) : [] })
})

function splitIntoSets(questions: QuestionInput[], sets: number) {
  return dealIntoSets(questions, sets).map(({ question, set }) => ({ ...question, setLabel: set }))
}

function clamp(value: string | undefined, min: number, max: number) {
  const number = Math.round(Number(value))
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min
}

async function readFields(request: Request) {
  const type = request.headers.get('content-type') ?? ''
  if (type.includes('multipart/form-data')) {
    const form = await request.formData()
    const text = (name: string) => (form.has(name) ? String(form.get(name) ?? '').trim() : undefined)
    return { ...commonFields(text), files: await readSourceFiles(form) }
  }
  const body = await request.json().catch(() => ({}))
  const text = (name: string) => (body[name] === undefined ? undefined : String(body[name]).trim())
  return { ...commonFields(text), files: [] as SourceFile[] }
}

function commonFields(text: (name: string) => string | undefined) {
  return {
    topic: text('topic') ?? '', description: text('description') ?? '', sourceText: text('sourceText') ?? '', bloomMode: text('bloomMode') ?? '',
    count: text('count'), mcqCount: text('mcqCount'), tfCount: text('tfCount'), codingCount: text('codingCount'), sets: text('sets'),
    levels: Object.fromEntries(BLOOM_LEVELS.map(level => [level, text(level)])) as Record<string, string | undefined>,
  }
}

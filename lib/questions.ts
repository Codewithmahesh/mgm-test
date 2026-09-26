import { DIFFICULTIES, type QuestionDoc } from './models'

export type Sample = { input: string; output: string; explanation: string }

export type QuestionInput = {
  type: 'mcq' | 'tf' | 'coding'
  text: string
  title: string
  inputFormat: string
  outputFormat: string
  constraints: string
  samples: Sample[]
  points: number | null
  options: string[]
  correctIndex: number | null
  topic: string
  difficulty: (typeof DIFFICULTIES)[number] | null
  explanation: string
  language: string
  starterCode: string
}

/** RFC 4180 CSV parser: handles quoted cells, escaped quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const input = text.replace(/^﻿/, '')
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i++ }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(cell); cell = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += char
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.map(r => r.map(c => c.trim())).filter(r => r.some(Boolean))
}

const HEADER_ALIASES: Record<string, string[]> = {
  text: ['question', 'prompt', 'text', 'questiontext'],
  a: ['optiona', 'option1', 'a', 'opt1', 'choicea'],
  b: ['optionb', 'option2', 'b', 'opt2', 'choiceb'],
  c: ['optionc', 'option3', 'c', 'opt3', 'choicec'],
  d: ['optiond', 'option4', 'd', 'opt4', 'choiced'],
  answer: ['answer', 'correct', 'correctanswer', 'correctoption', 'key'],
  type: ['type', 'questiontype'],
  topic: ['topic', 'subject', 'chapter'],
  difficulty: ['difficulty', 'level'],
  explanation: ['explanation', 'solution'],
  language: ['language', 'lang'],
  starterCode: ['startercode', 'starter', 'template'],
  title: ['title', 'problemtitle', 'name'],
  inputFormat: ['inputformat', 'input'],
  outputFormat: ['outputformat', 'output'],
  constraints: ['constraints', 'constraint', 'limits'],
  sampleInput: ['sampleinput', 'exampleinput'],
  sampleOutput: ['sampleoutput', 'exampleoutput'],
  points: ['points', 'marks', 'score'],
}

/** Resolves an answer written as a letter (A–D), a number (1–4), True/False, or the option's text. */
export function resolveAnswer(answer: string, options: string[]): number | null {
  const value = answer.trim()
  if (!value) return null
  if (/^[a-d]$/i.test(value)) return value.toUpperCase().charCodeAt(0) - 65
  if (/^option\s*[a-d]$/i.test(value)) return value.slice(-1).toUpperCase().charCodeAt(0) - 65
  if (/^[1-4]$/.test(value) && Number(value) <= options.length) return Number(value) - 1
  const index = options.findIndex(option => option.toLowerCase() === value.toLowerCase())
  if (index >= 0) return index
  if (/^(t|true)$/i.test(value)) return options.findIndex(o => /^true$/i.test(o))
  if (/^(f|false)$/i.test(value)) return options.findIndex(o => /^false$/i.test(o))
  return null
}

function normalizeType(value: string | undefined, options: string[]): QuestionInput['type'] {
  const type = (value ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (['coding', 'code', 'program', 'programming'].includes(type)) return 'coding'
  if (['tf', 'truefalse', 'boolean'].includes(type)) return 'tf'
  if (options.length === 2 && options.every(o => /^(true|false)$/i.test(o))) return 'tf'
  return 'mcq'
}

function normalizeDifficulty(value: unknown): QuestionInput['difficulty'] {
  const level = String(value ?? '').toLowerCase().trim()
  return (DIFFICULTIES as readonly string[]).includes(level) ? (level as QuestionInput['difficulty']) : null
}

/** Validates and cleans one question. Returns an error string when it can't be used. */
export function normalizeQuestion(raw: Record<string, unknown>): QuestionInput | string {
  const text = String(raw.text ?? raw.question ?? '').trim()
  if (!text) return 'missing question text'
  const options = (Array.isArray(raw.options) ? raw.options : []).map(o => String(o ?? '').trim()).filter(Boolean)
  const type = normalizeType(typeof raw.type === 'string' ? raw.type : undefined, options)
  const base = {
    text: text.slice(0, 5000),
    topic: String(raw.topic ?? '').trim().slice(0, 120),
    difficulty: normalizeDifficulty(raw.difficulty),
    explanation: String(raw.explanation ?? '').trim().slice(0, 5000),
  }
  const noCoding = { title: '', inputFormat: '', outputFormat: '', constraints: '', samples: [] as Sample[], points: null }
  if (type === 'coding') {
    const samples = (Array.isArray(raw.samples) ? raw.samples : [])
      .map(sample => (sample ?? {}) as Record<string, unknown>)
      .map(sample => ({ input: String(sample.input ?? '').slice(0, 5000), output: String(sample.output ?? '').slice(0, 5000), explanation: String(sample.explanation ?? '').slice(0, 2000) }))
      .filter(sample => sample.input.trim() || sample.output.trim())
      .slice(0, 10)
    const points = Number(raw.points)
    return {
      ...base,
      type,
      title: String(raw.title ?? '').trim().slice(0, 150) || text.split(/[.\n]/)[0].slice(0, 80),
      inputFormat: String(raw.inputFormat ?? '').slice(0, 5000),
      outputFormat: String(raw.outputFormat ?? '').slice(0, 5000),
      constraints: String(raw.constraints ?? '').slice(0, 3000),
      samples,
      points: Number.isFinite(points) && points > 0 ? Math.min(points, 1000) : null,
      options: [],
      correctIndex: null,
      language: String(raw.language ?? '').trim().toLowerCase(),
      starterCode: String(raw.starterCode ?? '').slice(0, 10000),
    }
  }
  const finalOptions = type === 'tf' && options.length < 2 ? ['True', 'False'] : options
  if (finalOptions.length < 2) return 'needs at least two options'
  if (new Set(finalOptions.map(o => o.toLowerCase())).size !== finalOptions.length) return 'has duplicate options'
  const correctIndex = typeof raw.correctIndex === 'number' ? raw.correctIndex : resolveAnswer(String(raw.answer ?? ''), finalOptions)
  if (correctIndex === null || correctIndex < 0 || correctIndex >= finalOptions.length) return 'answer does not match any option'
  return { ...base, ...noCoding, type, options: finalOptions, correctIndex, language: '', starterCode: '' }
}

/** Turns CSV text into questions, reporting rows that couldn't be imported. */
export function questionsFromCsv(csv: string) {
  const rows = parseCsv(csv)
  const header = (rows.shift() ?? []).map(cell => cell.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const column = (key: string) => header.findIndex(cell => HEADER_ALIASES[key].includes(cell))
  const cols = Object.fromEntries(Object.keys(HEADER_ALIASES).map(key => [key, column(key)]))
  if (cols.text < 0) return { questions: [], errors: ['The CSV needs a "question" column. Expected: question, optionA, optionB, optionC, optionD, answer'] }

  const questions: QuestionInput[] = []
  const errors: string[] = []
  rows.forEach((row, index) => {
    const get = (key: string) => (cols[key] >= 0 ? row[cols[key]] ?? '' : '')
    const result = normalizeQuestion({
      text: get('text'),
      options: ['a', 'b', 'c', 'd'].map(get),
      answer: get('answer'),
      type: get('type') || undefined,
      topic: get('topic'),
      difficulty: get('difficulty'),
      explanation: get('explanation'),
      language: get('language'),
      starterCode: get('starterCode'),
      title: get('title'),
      inputFormat: get('inputFormat'),
      outputFormat: get('outputFormat'),
      constraints: get('constraints'),
      samples: [{ input: get('sampleInput'), output: get('sampleOutput') }],
      points: get('points'),
    })
    if (typeof result === 'string') errors.push(`Row ${index + 2}: ${result}`)
    else questions.push(result)
  })
  return { questions, errors }
}

/** Teacher view of a question, including the answer. */
export function serializeQuestion(q: QuestionDoc) {
  return {
    id: String(q._id),
    room: q.room ? String(q.room) : null,
    type: q.type,
    text: q.text,
    options: q.options,
    correctIndex: q.correctIndex,
    topic: q.topic ?? '',
    difficulty: q.difficulty ?? null,
    explanation: q.explanation ?? '',
    language: q.language ?? '',
    starterCode: q.starterCode ?? '',
    title: q.title ?? '',
    inputFormat: q.inputFormat ?? '',
    outputFormat: q.outputFormat ?? '',
    constraints: q.constraints ?? '',
    samples: (q.samples ?? []).map(sample => ({ input: sample.input ?? '', output: sample.output ?? '', explanation: sample.explanation ?? '' })),
    points: q.points ?? null,
    source: q.source,
    createdAt: q.createdAt,
  }
}

/** Fields to duplicate when copying a bank question into a room. */
export function copyOf(q: Record<string, unknown>) {
  const { _id, __v, room, teacher, createdAt, updatedAt, ...rest } = q
  void _id; void __v; void room; void teacher; void createdAt; void updatedAt
  return rest
}

import { NextResponse } from 'next/server'
import { HttpError, handler, readJson, requireTeacher } from '@/lib/auth'
import { questionsFromCsv } from '@/lib/questions'

const MAX_CSV_BYTES = 2 * 1024 * 1024

/**
 * POST /api/questions/import { csv } — parses and validates a CSV without saving,
 * so the teacher can review it first. Save with POST /api/questions.
 */
export const POST = handler(async (request: Request) => {
  await requireTeacher()
  const body = await readJson(request)
  const csv = String(body.csv ?? '')
  if (!csv.trim()) throw new HttpError(400, 'The CSV file is empty.')
  if (csv.length > MAX_CSV_BYTES) throw new HttpError(413, 'The CSV is larger than 2 MB. Split it into smaller files.')

  const { questions, errors } = questionsFromCsv(csv)
  if (!questions.length) throw new HttpError(400, errors[0] ?? 'No questions were found in this CSV.')
  return NextResponse.json({ questions, errors })
})

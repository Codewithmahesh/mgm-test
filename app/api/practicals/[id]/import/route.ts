import { NextResponse } from 'next/server'
import { HttpError, handler, rateLimit, requireTeacher } from '@/lib/auth'
import { extractPracticalList, findTeacherSubject } from '@/lib/practicals'
import { readSourceFiles } from '@/lib/source-files'

export const maxDuration = 120

type Context = { params: Promise<{ id: string }> }

/**
 * POST /api/practicals/:id/import (multipart "files": images, PDF or Word) — reads the practical list in the
 * files and returns its experiments ({ title, aim } in order) for the faculty member to review. Nothing is
 * saved; each chosen item is then written up and added with POST /api/practicals/:id/generate (mode "experiment").
 */
export const POST = handler(async (request: Request, context: Context) => {
  const teacher = await requireTeacher()
  await findTeacherSubject(teacher._id, (await context.params).id)
  await rateLimit(`practical-import:teacher:${teacher._id}`, 20, 60 * 60)
  const files = await readSourceFiles(await request.formData(), { images: true })
  if (!files.length) throw new HttpError(400, 'Choose a photo, PDF or Word file of the practical list.')
  return NextResponse.json({ experiments: await extractPracticalList(files) })
})

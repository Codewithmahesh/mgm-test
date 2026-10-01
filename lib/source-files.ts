import 'server-only'
import WordExtractor from 'word-extractor'
import { HttpError } from './auth'

// Vercel caps request bodies at 4.5 MB, so all uploads together must stay under that.
export const MAX_SOURCE_BYTES = 4 * 1024 * 1024
export const MAX_SOURCE_FILES = 10
const MAX_TEXT_CHARS = 80_000

export const SOURCE_EXTENSIONS = ['.pdf', '.doc', '.docx', '.tex'] as const
/** Photos or scans (e.g. of a printed practical list), read by the AI directly. */
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const
const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

type Part = { text: string } | { inline_data: { mime_type: string; data: string } }
export type SourceFile = { name: string; data: Buffer }

export function extensionOf(name: string) {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

/** Rejects files of other types (PDF, Word and LaTeX by default; pass `images` to allow photos too), or uploads that are too large together. */
export function checkSourceFiles(files: { name: string; size: number }[], { images = false } = {}) {
  if (files.length > MAX_SOURCE_FILES) throw new HttpError(400, `Upload at most ${MAX_SOURCE_FILES} files at a time.`)
  const allowed: readonly string[] = images ? [...SOURCE_EXTENSIONS, ...IMAGE_EXTENSIONS] : SOURCE_EXTENSIONS
  for (const file of files) {
    if (!allowed.includes(extensionOf(file.name))) throw new HttpError(400, `${file.name}: only PDF, Word (.doc, .docx)${images ? ', images (.png, .jpg, .webp)' : ''} and LaTeX (.tex) files are supported.`)
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_SOURCE_BYTES) throw new HttpError(413, 'The files add up to more than 4 MB. Remove some or compress them and try again.')
}

/**
 * Turns uploaded files into Gemini parts: PDFs go in as-is, Word documents and LaTeX sources
 * are converted to text first (Gemini doesn't read .doc/.docx directly).
 */
export async function sourceFileParts(files: SourceFile[]): Promise<Part[]> {
  const extractor = new WordExtractor()
  return Promise.all(files.map(async (file): Promise<Part> => {
    const buffer = file.data
    const ext = extensionOf(file.name)
    if (ext === '.pdf') return { inline_data: { mime_type: 'application/pdf', data: buffer.toString('base64') } }
    if (IMAGE_TYPES[ext]) return { inline_data: { mime_type: IMAGE_TYPES[ext], data: buffer.toString('base64') } }
    let text: string
    try {
      text = ext === '.tex' ? buffer.toString('utf8') : (await extractor.extract(buffer)).getBody()
    } catch {
      throw new HttpError(400, `Could not read ${file.name}. Check that it isn't corrupted or password protected.`)
    }
    text = text.trim()
    if (!text) throw new HttpError(400, `${file.name} has no readable text.`)
    const label = ext === '.tex' ? 'LaTeX source' : 'Word document'
    return { text: `${label} "${file.name}":\n"""\n${text.slice(0, MAX_TEXT_CHARS)}\n"""` }
  }))
}

/** Reads, checks and loads the uploaded files from a multipart form ("pdf" is the old single-file field name). */
export async function readSourceFiles(form: FormData, options: { images?: boolean } = {}): Promise<SourceFile[]> {
  const files = [...form.getAll('files'), ...form.getAll('pdf')].filter((file): file is File => file instanceof File && file.size > 0)
  checkSourceFiles(files, options)
  return Promise.all(files.map(async file => ({ name: file.name, data: Buffer.from(await file.arrayBuffer()) })))
}

import { NextResponse } from 'next/server'
import { HttpError, handler, readJson, requireTeacher } from '@/lib/auth'
import { Student, isObjectId } from '@/lib/models'
import { allowedDomains, checkStudentEmail, serializeStudent } from '@/lib/students'

/** GET /api/students?q=&classroom=&status=active|invited&page=&limit= — the college student list. */
export const GET = handler(async (request: Request) => {
  await requireTeacher()
  const url = new URL(request.url)
  const search = url.searchParams.get('q')?.trim()
  const classroom = url.searchParams.get('classroom')
  const status = url.searchParams.get('status')
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50))

  const filter: Record<string, unknown> = {}
  if (classroom === 'none') filter.classroom = { $exists: false }
  else if (classroom && isObjectId(classroom)) filter.classroom = classroom
  if (status === 'active') filter.activatedAt = { $exists: true, $ne: null }
  if (status === 'invited') filter.activatedAt = null
  if (search) {
    const pattern = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
    filter.$or = [{ name: pattern }, { officialEmail: pattern }, { rollNumber: pattern }, { prn: pattern }]
  }

  const [total, active, students] = await Promise.all([
    Student.countDocuments(filter),
    Student.countDocuments({ ...filter, activatedAt: { $exists: true, $ne: null } }),
    Student.find(filter).populate('classroom').select('-passwordHash').sort({ classroom: 1, rollNumber: 1, name: 1, _id: 1 }).collation({ locale: 'en', numericOrdering: true }).skip((page - 1) * limit).limit(limit).lean(),
  ])
  return NextResponse.json({ total, active, page, limit, domains: allowedDomains(), students: students.map(serializeStudent) })
})

/** POST /api/students { emails: string[] | text } — adds college emails to the student list (skips ones already there). */
export const POST = handler(async (request: Request) => {
  const teacher = await requireTeacher()
  const body = await readJson(request)
  const raw = Array.isArray(body.emails) ? body.emails.join('\n') : String(body.emails ?? body.text ?? '')
  const candidates = [...new Set((raw.match(/[^\s,;<>"']+@[^\s,;<>"']+/g) ?? []).map(email => email.toLowerCase().replace(/[.)]+$/, '')))]
  if (!candidates.length) throw new HttpError(400, 'Paste at least one college email.')
  if (candidates.length > 2000) throw new HttpError(400, 'Add at most 2000 students at a time.')

  const invalid: string[] = []
  const valid = candidates.filter(email => {
    const problem = checkStudentEmail(email)
    if (problem) invalid.push(`${email}: ${problem}`)
    return !problem
  })
  const existing = new Set((await Student.find({ officialEmail: { $in: valid } }).select('officialEmail').lean()).map(s => s.officialEmail))
  const fresh = valid.filter(email => !existing.has(email))
  let added = 0
  if (fresh.length) {
    try {
      added = (await Student.insertMany(fresh.map(officialEmail => ({ officialEmail, addedBy: teacher._id })), { ordered: false, throwOnValidationError: true })).length
    } catch (error) {
      // A concurrent add of the same email trips the unique index; count what did go in.
      const inserted = (error as { insertedDocs?: unknown[] }).insertedDocs
      if ((error as { code?: number }).code !== 11000 || !inserted) throw error
      added = inserted.length
    }
  }

  return NextResponse.json({ added, alreadyListed: valid.length - added, invalid }, { status: added ? 201 : 200 })
})

import { NextResponse } from 'next/server'
import { HttpError, handler, requireTeacher } from '@/lib/auth'
import { Attempt, PasswordReset, Student, isObjectId } from '@/lib/models'
import { serializeStudent } from '@/lib/students'

type Context = { params: Promise<{ id: string }> }

async function find(context: Context) {
  await requireTeacher()
  const { id } = await context.params
  if (!isObjectId(id)) throw new HttpError(404, 'Student not found.')
  const student = await Student.findById(id).populate('classroom').select('-passwordHash')
  if (!student) throw new HttpError(404, 'Student not found.')
  return student
}

/** GET /api/students/:id — profile plus exam history. */
export const GET = handler(async (_request: Request, context: Context) => {
  const student = await find(context)
  const attempts = await Attempt.find({ $or: [{ student: student._id }, { studentEmail: student.officialEmail }] })
    .populate<{ room: { title: string; code: string } | null }>('room', 'title code')
    .select('room status score maxScore submittedAt startedAt tabSwitches')
    .sort({ createdAt: -1 })
    .lean()
  return NextResponse.json({
    student: serializeStudent(student.toObject()),
    attempts: attempts.map(a => ({ id: String(a._id), room: a.room?.title ?? 'Deleted room', code: a.room?.code ?? '', status: a.status, score: a.score, maxScore: a.maxScore, submittedAt: a.submittedAt, startedAt: a.startedAt, tabSwitches: a.tabSwitches ?? 0 })),
  })
})

/** DELETE /api/students/:id — removes the student from the list (their past results are kept). */
export const DELETE = handler(async (_request: Request, context: Context) => {
  const student = await find(context)
  await PasswordReset.deleteMany({ account: student._id })
  await student.deleteOne()
  return NextResponse.json({ ok: true })
})

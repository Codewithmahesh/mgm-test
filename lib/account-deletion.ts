import 'server-only'
import bcrypt from 'bcryptjs'
import type { Types } from 'mongoose'
import { HttpError } from './auth'
import { renderEmail } from './email-template'
import { sendMail } from './mail'
import {
  Attempt, ExamRoom, Experiment, GenerationJob, JoinRequest, PasswordReset, PracticalJob, PracticalSubject, PracticalSubmission,
  PracticeProblem, Question, RateLimit, Student, Teacher,
} from './models'

// Deleting an account for good, with everything that belongs to it. Data is removed first and the account
// itself last, so if anything fails half-way the person can simply try again.
//
// Faculty: their exam rooms (with every student's attempt and join request in them), question bank, AI
// generations, practicals (experiments, practice problems, students' submissions and AI jobs), sign-in
// codes and rate-limit counters. Student accounts they added stay (they belong to the students); only the
// "added by" link is removed.
// Students: their exam attempts and join requests, practical submissions, their own AI practice problems,
// sign-in codes and rate-limit counters. Faculty's rooms and practicals are not touched.

/** The words a person types to confirm, so a stray click can't delete an account. */
export const CONFIRM_WORD = 'DELETE'

/** Checks the password and the typed confirmation. Throws 400/403 when either is wrong. */
export async function confirmDeletion(passwordHash: string | null | undefined, body: Record<string, unknown>) {
  if (String(body.confirm ?? '').trim().toUpperCase() !== CONFIRM_WORD) throw new HttpError(400, `Type ${CONFIRM_WORD} to confirm.`)
  const password = String(body.password ?? '')
  if (!password) throw new HttpError(400, 'Enter your password to confirm.')
  if (!passwordHash || !(await bcrypt.compare(password, passwordHash))) throw new HttpError(403, 'That password is not correct.')
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Rate-limit counters keyed by this account's id or email (they expire anyway; removed for completeness). */
async function deleteRateLimits(id: Types.ObjectId, email: string) {
  const keys = [String(id), email].filter(Boolean).map(escapeRegex)
  if (keys.length) await RateLimit.deleteMany({ _id: { $regex: `(?:^|:)(?:${keys.join('|')})(?:$|:)` } })
}

export async function deleteTeacherAccount(teacherId: Types.ObjectId) {
  const teacher = await Teacher.findById(teacherId).select('name email').lean()
  if (!teacher) return null

  // Exam rooms, and everything students did in them.
  const rooms = (await ExamRoom.find({ teacher: teacherId }).select('_id').lean()).map(r => r._id)
  await Attempt.deleteMany({ room: { $in: rooms } })
  await JoinRequest.deleteMany({ room: { $in: rooms } })
  await Question.deleteMany({ $or: [{ teacher: teacherId }, { room: { $in: rooms } }] })
  await ExamRoom.deleteMany({ teacher: teacherId })
  await GenerationJob.deleteMany({ teacher: teacherId })

  // Practicals, and everything students did in them.
  const subjects = (await PracticalSubject.find({ teacher: teacherId }).select('_id').lean()).map(s => s._id)
  await PracticalSubmission.deleteMany({ subject: { $in: subjects } })
  await PracticeProblem.deleteMany({ subject: { $in: subjects } })
  await Experiment.deleteMany({ $or: [{ teacher: teacherId }, { subject: { $in: subjects } }] })
  await PracticalJob.deleteMany({ $or: [{ teacher: teacherId }, { subject: { $in: subjects } }] })
  await PracticalSubject.deleteMany({ teacher: teacherId })

  // Students stay; they only lose the link to who added them.
  await Student.updateMany({ addedBy: teacherId }, { $unset: { addedBy: 1 } })
  await PasswordReset.deleteMany({ role: 'teacher', account: teacherId })
  await deleteRateLimits(teacherId, teacher.email)
  await Teacher.deleteOne({ _id: teacherId })

  await sendGoodbye(teacher.email, teacher.name, 'faculty', [
    'Your exam rooms, with every student attempt and result in them',
    'Your question bank and AI generations',
    'Your practicals, their experiments and the students’ submissions',
  ])
  return { rooms: rooms.length, practicals: subjects.length }
}

export async function deleteStudentAccount(studentId: Types.ObjectId) {
  const student = await Student.findById(studentId).select('name officialEmail').lean()
  if (!student) return null
  const email = student.officialEmail ?? ''
  const mine = email ? { $or: [{ student: studentId }, { studentEmail: email }] } : { student: studentId }

  const attempts = await Attempt.deleteMany(mine)
  await JoinRequest.deleteMany(mine)
  const submissions = await PracticalSubmission.deleteMany({ student: studentId })
  // AI practice problems written just for this student (faculty problems are shared and stay).
  await PracticeProblem.deleteMany({ student: studentId, source: 'ai' })
  await PasswordReset.deleteMany({ role: 'student', account: studentId })
  await deleteRateLimits(studentId, email)
  await Student.deleteOne({ _id: studentId })

  if (email) await sendGoodbye(email, student.name ?? '', 'student', [
    'Your profile and sign-in',
    'Your exam attempts, answers and results',
    'Your practical submissions and AI practice problems',
  ])
  return { attempts: attempts.deletedCount, submissions: submissions.deletedCount }
}

/** A last email confirming the deletion. Never throws: the account is already gone. */
async function sendGoodbye(to: string, name: string, kind: 'faculty' | 'student', removed: string[]) {
  try {
    await sendMail({
      to,
      subject: 'Your account has been deleted',
      ...renderEmail({
        preview: 'Your account and everything in it have been permanently deleted.',
        tag: 'Account deleted',
        heading: 'Your account has been deleted',
        greeting: name ? `Hi ${name},` : 'Hi,',
        paragraphs: [
          `As you asked, your ${kind} account and everything in it have been permanently deleted. This can't be undone.`,
          kind === 'student'
            ? 'If your faculty add your email again, you can activate a fresh account.'
            : 'You can sign up again at any time with the same email.',
        ],
        lists: [{ title: 'Deleted', tone: 'info', items: removed }],
        footnote: "If you didn't ask for this, contact your college's exam coordinator.",
      }),
    })
  } catch (error) {
    console.error('[account] goodbye email failed:', error)
  }
}

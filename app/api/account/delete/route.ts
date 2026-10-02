import { NextResponse } from 'next/server'
import { CONFIRM_WORD, confirmDeletion, deleteStudentAccount, deleteTeacherAccount } from '@/lib/account-deletion'
import { HttpError, clientIp, handler, rateLimit, readJson } from '@/lib/auth'
import { connectDb } from '@/lib/db'
import { Student, Teacher } from '@/lib/models'

/**
 * POST /api/account/delete { account: 'teacher' | 'student', email, password, confirm: "DELETE" } — the public
 * deletion page (/delete-account): deletes an account without signing in to the website or installing the
 * app, by checking the email and password. Same deletion as DELETE /api/auth/me and /api/student/me.
 */
export const POST = handler(async (request: Request) => {
  const body = await readJson(request)
  const account = body.account === 'teacher' ? 'teacher' : body.account === 'student' ? 'student' : null
  if (!account) throw new HttpError(400, 'Choose whether this is a faculty or a student account.')
  const email = String(body.email ?? '').trim().toLowerCase()
  if (!email) throw new HttpError(400, 'Enter the email you sign in with.')
  if (String(body.confirm ?? '').trim().toUpperCase() !== CONFIRM_WORD) throw new HttpError(400, `Type ${CONFIRM_WORD} to confirm.`)
  await rateLimit(`delete-account:ip:${clientIp(request)}`, 10, 60 * 60)
  await rateLimit(`delete-account:email:${email}`, 5, 15 * 60)
  await connectDb()

  // The same answer for an unknown email and a wrong password, so the page can't be used to find accounts.
  const wrong = new HttpError(403, 'The email or password is not correct.')
  if (account === 'teacher') {
    const teacher = await Teacher.findOne({ email }).select('passwordHash').lean()
    if (!teacher) throw wrong
    await confirmDeletion(teacher.passwordHash, body).catch(() => { throw wrong })
    await deleteTeacherAccount(teacher._id)
  } else {
    const student = await Student.findOne({ officialEmail: email }).select('passwordHash').lean()
    if (!student?.passwordHash) throw wrong
    await confirmDeletion(student.passwordHash, body).catch(() => { throw wrong })
    await deleteStudentAccount(student._id)
  }
  return NextResponse.json({ ok: true })
})

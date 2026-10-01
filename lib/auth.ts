import 'server-only'
import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { connectDb } from './db'
import { RateLimit, Student, Teacher } from './models'
import { STUDENT_COOKIE, TEACHER_COOKIE, signToken, verifyToken, type StudentToken, type TeacherToken } from './session'

const TEACHER_MAX_AGE = 60 * 60 * 24 * 7
const STUDENT_MAX_AGE = 60 * 60 * 24 * 7

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge,
})

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message)
  }
}

/** Wraps a route handler so thrown HttpErrors become JSON responses and anything else a generic 500. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args)
    } catch (error) {
      if (error instanceof HttpError) return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status })
      console.error(error)
      return NextResponse.json({ error: 'Something went wrong on the server. Please try again.' }, { status: 500 })
    }
  }
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.')
  }
}

/** Sets the session cookie. Returns `{ token }` for the mobile app (x-client: mobile) to spread into the JSON reply, else `{}`. */
export async function setTeacherSession(teacher: { _id: unknown; name: string }) {
  const token = await signToken({ sub: String(teacher._id), role: 'teacher', name: teacher.name }, TEACHER_MAX_AGE)
  ;(await cookies()).set(TEACHER_COOKIE, token, cookieOptions(TEACHER_MAX_AGE))
  return mobileToken(token)
}

export async function setStudentSession(studentId: string) {
  const token = await signToken({ sub: studentId, role: 'student' }, STUDENT_MAX_AGE)
  ;(await cookies()).set(STUDENT_COOKIE, token, cookieOptions(STUDENT_MAX_AGE))
  return mobileToken(token)
}

async function mobileToken(token: string): Promise<{ token?: string }> {
  return (await headers()).get('x-client') === 'mobile' ? { token } : {}
}

/** The session token from the cookie (web) or an `Authorization: Bearer` header (mobile app). */
export async function sessionToken(cookie: typeof TEACHER_COOKIE | typeof STUDENT_COOKIE) {
  const bearer = (await headers()).get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  return (await cookies()).get(cookie)?.value ?? bearer
}

export async function clearCookie(name: typeof TEACHER_COOKIE | typeof STUDENT_COOKIE) {
  ;(await cookies()).delete(name)
}

/** Returns the signed-in teacher or throws 401. */
export async function requireTeacher() {
  const session = await verifyToken<TeacherToken>(await sessionToken(TEACHER_COOKIE), 'teacher')
  if (!session) throw new HttpError(401, 'Please sign in to continue.')
  await connectDb()
  const teacher = await Teacher.findById(session.sub).select('-passwordHash').lean()
  if (!teacher) throw new HttpError(401, 'Your account no longer exists. Please sign in again.')
  return teacher
}

/** Whoever is signed in (faculty or student), or null. Only checks the token, no database lookup. */
export async function signedInUser(): Promise<{ role: 'teacher' | 'student'; id: string } | null> {
  const teacher = await verifyToken<TeacherToken>(await sessionToken(TEACHER_COOKIE), 'teacher')
  if (teacher) return { role: 'teacher', id: teacher.sub }
  const student = await verifyToken<StudentToken>(await sessionToken(STUDENT_COOKIE), 'student')
  return student ? { role: 'student', id: student.sub } : null
}

/** Returns the signed-in, activated student or throws 401. Pass `requireProfile` to also demand a completed profile. */
export async function requireStudent({ requireProfile = true } = {}) {
  const session = await verifyToken<StudentToken>(await sessionToken(STUDENT_COOKIE), 'student')
  if (!session) throw new HttpError(401, 'Please sign in with your college email to continue.')
  await connectDb()
  const student = await Student.findById(session.sub).populate<{ classroom: { _id: unknown; class?: string; branch?: string; division?: string } | null }>('classroom').select('-passwordHash')
  if (!student || !student.activatedAt) throw new HttpError(401, 'Your account is not active. Please sign in again.')
  if (requireProfile && !student.profileCompletedAt) throw new HttpError(403, 'Complete your profile before continuing.')
  return student
}

export function clientIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local'
}

/** Fixed-window rate limit stored in MongoDB (works across server instances). */
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  await connectDb()
  const now = new Date()
  const entry = await RateLimit.findOneAndUpdate(
    { _id: key, expiresAt: { $gt: now } },
    { $inc: { count: 1 } },
    { returnDocument: 'after' },
  ).lean()
  if (!entry) {
    await RateLimit.updateOne({ _id: key }, { $set: { count: 1, expiresAt: new Date(now.getTime() + windowSeconds * 1000) } }, { upsert: true })
    return
  }
  if (entry.count > limit) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.')
}

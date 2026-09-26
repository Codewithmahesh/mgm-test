import { SignJWT, jwtVerify } from 'jose'

// Edge-safe token helpers (no database access), shared by proxy.ts and route handlers.

export const TEACHER_COOKIE = 'examly_session'
export const STUDENT_COOKIE = 'examly_student'

export type TeacherToken = { sub: string; role: 'teacher'; name: string }
export type StudentToken = { sub: string; role: 'student' }
/** Short-lived proof that someone entered the right OTP; lets them set a password on that one account. */
export type OtpTicket = { sub: string; role: 'otp-ticket'; purpose: 'activate' | 'reset'; account: 'teacher' | 'student' }

type AnyToken = TeacherToken | StudentToken | OtpTicket

function secretKey() {
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.length < 32) throw new Error('AUTH_SECRET must be set to a random string of at least 32 characters.')
  return new TextEncoder().encode(secret)
}

export async function signToken(payload: AnyToken, maxAgeSeconds: number) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAgeSeconds)
    .sign(secretKey())
}

export async function verifyToken<T extends AnyToken>(token: string | undefined, role: T['role']): Promise<T | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] })
    return payload.role === role && typeof payload.sub === 'string' ? (payload as unknown as T) : null
  } catch {
    return null
  }
}

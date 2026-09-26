import { NextResponse } from 'next/server'
import { clearCookie, handler } from '@/lib/auth'
import { STUDENT_COOKIE } from '@/lib/session'

export const POST = handler(async () => {
  await clearCookie(STUDENT_COOKIE)
  return NextResponse.json({ ok: true })
})

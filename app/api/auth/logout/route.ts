import { NextResponse } from 'next/server'
import { clearCookie, handler } from '@/lib/auth'
import { TEACHER_COOKIE } from '@/lib/session'

export const POST = handler(async () => {
  await clearCookie(TEACHER_COOKIE)
  return NextResponse.json({ ok: true })
})

import { NextResponse, type NextRequest } from 'next/server'
import { STUDENT_COOKIE, TEACHER_COOKIE, verifyToken, type StudentToken, type TeacherToken } from './lib/session'

const TEACHER_PUBLIC = ['/teacher/login', '/teacher/signup', '/teacher/forgot-password', '/teacher/reset-password']
const STUDENT_PUBLIC = ['/student/login', '/student/activate', '/student/forgot-password']

// Optimistic redirects only. Every API route checks the session again itself.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (pathname === '/teacher' || pathname.startsWith('/teacher/')) {
    const signedIn = await verifyToken<TeacherToken>(request.cookies.get(TEACHER_COOKIE)?.value, 'teacher')
    const isPublic = TEACHER_PUBLIC.includes(pathname)
    if (!signedIn && !isPublic) return redirect(request, '/teacher/login', pathname + search)
    if (signedIn && isPublic) return NextResponse.redirect(new URL('/teacher', request.url))
  }

  if (pathname === '/student' || pathname.startsWith('/student/')) {
    const signedIn = await verifyToken<StudentToken>(request.cookies.get(STUDENT_COOKIE)?.value, 'student')
    const isPublic = STUDENT_PUBLIC.includes(pathname)
    if (!signedIn && !isPublic) return redirect(request, '/student/login', pathname + search)
    if (signedIn && isPublic) return NextResponse.redirect(new URL('/student', request.url))
  }

  return NextResponse.next()
}

function redirect(request: NextRequest, to: string, next: string) {
  const url = new URL(to, request.url)
  if (next !== '/teacher' && next !== '/student') url.searchParams.set('next', next)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/teacher', '/teacher/:path*', '/student', '/student/:path*'],
}

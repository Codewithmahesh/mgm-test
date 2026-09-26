import { NextResponse } from 'next/server'
import { handler, requireTeacher } from '@/lib/auth'

export const GET = handler(async () => {
  const teacher = await requireTeacher()
  return NextResponse.json({ teacher: { id: String(teacher._id), name: teacher.name, email: teacher.email, department: teacher.department ?? '' } })
})

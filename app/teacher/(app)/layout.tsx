'use client'

import { useEffect, useState } from 'react'
import { BookOpen, DoorOpen, FlaskConical, LayoutDashboard, Plus, Sparkles, Users } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { TeacherContext, type TeacherInfo as Teacher } from '@/components/role-context'
import { api } from '@/lib/api'

const nav = [
  { href: '/teacher', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/teacher/rooms', label: 'Exam rooms', icon: DoorOpen },
  { href: '/teacher/practicals', label: 'Practicals', icon: FlaskConical },
  { href: '/teacher/questions', label: 'Question bank', icon: BookOpen },
  { href: '/teacher/generations', label: 'AI generations', icon: Sparkles },
  { href: '/teacher/students', label: 'Students', icon: Users },
]

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const [teacher, setTeacher] = useState<Teacher | null>(null)
  useEffect(() => { api<{ teacher: Teacher }>('/api/auth/me').then(data => setTeacher(data.teacher)).catch(() => { window.location.href = '/teacher/login' }) }, [])

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
    window.location.href = '/teacher/login'
  }

  return (
    <TeacherContext.Provider value={teacher}>
      <AppShell role="Faculty" nav={nav} action={{ href: '/teacher/rooms/new', label: 'New exam room', icon: Plus }} user={teacher ? { name: teacher.name, email: teacher.email, detail: teacher.department } : null} onLogout={logout}>
        {children}
      </AppShell>
    </TeacherContext.Provider>
  )
}

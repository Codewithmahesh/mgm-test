'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { FlaskConical, KeyRound, LayoutDashboard, UserRound } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { StudentContext } from '@/components/role-context'
import { PageLoader } from '@/components/ui/card'
import { api, type StudentRow } from '@/lib/api'

const nav = [
  { href: '/student', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/student/practicals', label: 'Practicals', icon: FlaskConical },
  { href: '/student/profile', label: 'Profile', icon: UserRound },
]

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [student, setStudent] = useState<StudentRow | null>(null)

  const refresh = useCallback(() => {
    api<{ student: StudentRow }>('/api/student/me').then(data => setStudent(data.student)).catch(() => { window.location.href = '/student/login' })
  }, [])
  useEffect(refresh, [refresh])

  // A profile is required before anything else.
  useEffect(() => {
    if (student && !student.profileComplete && pathname !== '/student/profile') router.replace('/student/profile')
  }, [student, pathname, router])

  async function logout() {
    await api('/api/student/auth/logout', { method: 'POST' }).catch(() => {})
    window.location.href = '/student/login'
  }

  const blocked = !student || (!student.profileComplete && pathname !== '/student/profile')
  return (
    <StudentContext.Provider value={{ student, refresh }}>
      <AppShell role="Student" nav={nav} action={{ href: '/student#join', label: 'Join an exam', icon: KeyRound }} user={student ? { name: student.name, email: student.email, detail: [student.classLabel, student.rollNumber && `Roll ${student.rollNumber}`].filter(Boolean).join(' · ') } : null} onLogout={logout} profileHref="/student/profile">
        {blocked ? <PageLoader /> : children}
      </AppShell>
    </StudentContext.Provider>
  )
}

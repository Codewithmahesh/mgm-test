'use client'

import { createContext, useContext } from 'react'
import type { StudentRow } from '@/lib/api'

export type TeacherInfo = { id: string; name: string; email: string; department: string }

export const TeacherContext = createContext<TeacherInfo | null>(null)
export const useTeacher = () => useContext(TeacherContext)

export const StudentContext = createContext<{ student: StudentRow | null; refresh: () => void }>({ student: null, refresh: () => {} })
export const useStudent = () => useContext(StudentContext)

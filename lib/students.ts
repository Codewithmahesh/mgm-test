import 'server-only'
import { BRANCHES, Classroom, classLabel } from './models'

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Domains faculty may add, from STUDENT_EMAIL_DOMAINS (comma separated). Empty = any domain. */
export function allowedDomains() {
  return (process.env.STUDENT_EMAIL_DOMAINS ?? '').split(',').map(d => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean)
}

export function checkStudentEmail(email: string): string | null {
  if (!EMAIL_PATTERN.test(email)) return 'not a valid email address'
  const domains = allowedDomains()
  if (domains.length && !domains.includes(email.split('@')[1])) return `must be a college email (@${domains.join(', @')})`
  return null
}

type ClassroomLike = { _id?: unknown; class?: string | null; branch?: string | null; division?: string | null } | null | undefined

export function serializeStudent(student: {
  _id: unknown
  officialEmail?: string | null
  name?: string | null
  rollNumber?: string | null
  prn?: string | null
  classroom?: unknown
  activatedAt?: Date | null
  profileCompletedAt?: Date | null
  createdAt?: Date
}) {
  const classroom = (student.classroom && typeof student.classroom === 'object' && 'class' in (student.classroom as object) ? student.classroom : null) as ClassroomLike
  return {
    id: String(student._id),
    email: student.officialEmail ?? '',
    name: student.name ?? '',
    rollNumber: student.rollNumber ?? '',
    prn: student.prn ?? '',
    classroomId: classroom?._id ? String(classroom._id) : null,
    year: classroom?.class ?? '',
    branch: classroom?.branch ?? '',
    division: classroom?.division ?? '',
    classLabel: classLabel(classroom),
    status: student.activatedAt ? 'active' : 'invited',
    profileComplete: Boolean(student.profileCompletedAt),
    activatedAt: student.activatedAt ?? null,
    createdAt: student.createdAt ?? null,
  }
}

/** Finds or creates the classroom for a year/branch/division combination. */
export async function classroomFor(year: string, branch: string, division: string) {
  const normalizedYear = year === 'LY' ? 'B.Tech' : year.trim()
  const normalizedBranch = branch.toUpperCase().trim()
  const normalizedDivision = division.toUpperCase().trim()
  return Classroom.findOneAndUpdate(
    { class: normalizedYear, branch: normalizedBranch, division: normalizedDivision },
    { $setOnInsert: { class: normalizedYear, branch: normalizedBranch, division: normalizedDivision, branchName: BRANCHES[normalizedBranch] ?? normalizedBranch } },
    { upsert: true, returnDocument: 'after' },
  ).lean()
}

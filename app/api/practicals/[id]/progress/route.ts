import { NextResponse } from 'next/server'
import type { Types } from 'mongoose'
import { handler, requireTeacher } from '@/lib/auth'
import { Experiment, PracticalSubmission, Student, classLabel } from '@/lib/models'
import { findTeacherSubject, levels } from '@/lib/practicals'

type Context = { params: Promise<{ id: string }> }

type Row = {
  _id: { student: Types.ObjectId; experiment: Types.ObjectId; problem: Types.ObjectId | null }
  attempts: number
  solved: boolean
  solvedAt: Date | null
  hiddenPassed: number
  hiddenTotal: number
  lastAt: Date
}

/**
 * GET /api/practicals/:id/progress — every student of the subject's classes against every experiment:
 * solved / attempted / open / locked, attempts, best hidden-test score and practice done.
 */
export const GET = handler(async (_request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const subject = await findTeacherSubject(teacher._id, (await context.params).id)
  const [experiments, students, rows] = await Promise.all([
    Experiment.find({ subject: subject._id }).select('title order').sort({ order: 1 }).lean(),
    Student.find({ classroom: { $in: subject.classrooms }, activatedAt: { $ne: null } }).populate('classroom').select('name rollNumber prn officialEmail classroom').sort({ rollNumber: 1, name: 1 }).lean(),
    PracticalSubmission.aggregate<Row>([
      { $match: { subject: subject._id } },
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: { student: '$student', experiment: '$experiment', problem: '$problem' },
          attempts: { $sum: 1 },
          solved: { $max: '$solved' },
          solvedAt: { $min: { $cond: ['$solved', '$createdAt', null] } },
          hiddenPassed: { $max: '$hiddenPassed' },
          hiddenTotal: { $last: '$hiddenTotal' },
          lastAt: { $max: '$createdAt' },
        },
      },
    ]),
  ])

  // student -> experiment -> { main row, practice rows }
  const byStudent = new Map<string, Map<string, { main?: Row; practice: Row[] }>>()
  for (const row of rows) {
    const student = byStudent.get(String(row._id.student)) ?? new Map()
    byStudent.set(String(row._id.student), student)
    const cell = student.get(String(row._id.experiment)) ?? { practice: [] }
    student.set(String(row._id.experiment), cell)
    if (row._id.problem) cell.practice.push(row)
    else cell.main = row
  }

  const solvedBy = new Map<string, number>()
  const attemptedBy = new Map<string, number>()
  const studentRows = students.map(student => {
    const cells = byStudent.get(String(student._id)) ?? new Map<string, { main?: Row; practice: Row[] }>()
    const solved = new Set([...cells].filter(([, cell]) => cell.main?.solved).map(([id]) => id))
    let lastActivity: Date | null = null
    let practiceSolved = 0
    let practiceAttempted = 0
    const states = levels(experiments, solved).map(({ experiment, status }) => {
      const cell = cells.get(String(experiment._id))
      const main = cell?.main
      for (const row of [main, ...(cell?.practice ?? [])]) if (row && (!lastActivity || row.lastAt > lastActivity)) lastActivity = row.lastAt
      const practiceDone = cell?.practice.filter(p => p.solved).length ?? 0
      practiceSolved += practiceDone
      practiceAttempted += cell?.practice.length ?? 0
      if (status === 'solved') solvedBy.set(String(experiment._id), (solvedBy.get(String(experiment._id)) ?? 0) + 1)
      if (main) attemptedBy.set(String(experiment._id), (attemptedBy.get(String(experiment._id)) ?? 0) + 1)
      return {
        experiment: String(experiment._id),
        status: status === 'open' && main ? 'attempted' as const : status,
        attempts: main?.attempts ?? 0,
        solvedAt: main?.solvedAt ?? null,
        hiddenPassed: main ? main.hiddenPassed : null,
        hiddenTotal: main ? main.hiddenTotal : null,
        practiceSolved: practiceDone,
        practiceAttempted: cell?.practice.length ?? 0,
      }
    })
    const classroom = student.classroom as { class?: string; branch?: string; division?: string } | null
    return {
      id: String(student._id),
      name: student.name || student.officialEmail || 'Student',
      rollNumber: student.rollNumber ?? '',
      classLabel: classLabel(classroom),
      solved: solved.size,
      practiceSolved,
      practiceAttempted,
      lastActivity,
      cells: states,
    }
  })

  return NextResponse.json({
    experiments: experiments.map(e => ({ id: String(e._id), order: e.order, title: e.title, solvedBy: solvedBy.get(String(e._id)) ?? 0, attemptedBy: attemptedBy.get(String(e._id)) ?? 0 })),
    students: studentRows,
  })
})

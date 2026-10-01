import { NextResponse } from 'next/server'
import type { Types } from 'mongoose'
import { handler, requireStudent } from '@/lib/auth'
import { Experiment, PracticalSubject, PracticalSubmission, Teacher } from '@/lib/models'
import { levels } from '@/lib/practicals'

/** GET /api/student/practicals — the practicals the student's class takes, with their progress in each. */
export const GET = handler(async () => {
  const student = await requireStudent()
  if (!student.classroom) return NextResponse.json({ subjects: [] })
  const subjects = await PracticalSubject.find({ classrooms: student.classroom._id as Types.ObjectId }).sort({ createdAt: -1 }).lean()
  const ids = subjects.map(s => s._id)
  const [experiments, solvedRows, practice, teachers] = await Promise.all([
    Experiment.find({ subject: { $in: ids } }).select('subject title order').sort({ order: 1 }).lean(),
    PracticalSubmission.find({ subject: { $in: ids }, student: student._id, problem: null, solved: true }).distinct('experiment'),
    PracticalSubmission.aggregate<{ _id: unknown; solved: number }>([
      { $match: { subject: { $in: ids }, student: student._id, problem: { $ne: null }, solved: true } },
      { $group: { _id: { subject: '$subject', problem: '$problem' } } },
      { $group: { _id: '$_id.subject', solved: { $sum: 1 } } },
    ]),
    Teacher.find({ _id: { $in: subjects.map(s => s.teacher) } }).select('name').lean(),
  ])
  const solved = new Set(solvedRows.map(String))
  const practiceBySubject = new Map(practice.map(p => [String(p._id), p.solved]))
  const teacherName = new Map(teachers.map(t => [String(t._id), t.name]))

  return NextResponse.json({
    subjects: subjects.map(subject => {
      const own = experiments.filter(e => String(e.subject) === String(subject._id))
      const states = levels(own, solved)
      const next = states.find(s => s.status === 'open')
      return {
        id: String(subject._id),
        title: subject.title,
        code: subject.code ?? '',
        description: subject.description ?? '',
        faculty: teacherName.get(String(subject.teacher)) ?? '',
        experiments: own.length,
        solved: states.filter(s => s.status === 'solved').length,
        next: next ? { id: String(next.experiment._id), order: next.experiment.order, title: next.experiment.title } : null,
        practiceSolved: practiceBySubject.get(String(subject._id)) ?? 0,
      }
    }),
  })
})

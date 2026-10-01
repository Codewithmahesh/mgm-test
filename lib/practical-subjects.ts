import 'server-only'
import { Types } from 'mongoose'
import { HttpError } from './auth'
import { Classroom, Experiment, PracticalSubmission, Student, classLabel, isObjectId } from './models'

type SubjectDoc = { _id: Types.ObjectId; title: string; code?: string | null; description?: string | null; classrooms: Types.ObjectId[]; createdAt?: Date }

/** Subject fields from a request body; `partial` allows omitted fields (PATCH). */
export async function subjectSettings(body: Record<string, unknown>, partial = false) {
  const settings: Record<string, unknown> = {}
  if (!partial || 'title' in body) {
    const title = String(body.title ?? '').trim().slice(0, 150)
    if (!title) throw new HttpError(400, 'Give the practical a name.')
    settings.title = title
  }
  if (!partial || 'code' in body) settings.code = String(body.code ?? '').trim().slice(0, 30)
  if (!partial || 'description' in body) settings.description = String(body.description ?? '').trim().slice(0, 3000)
  if (!partial || 'classrooms' in body) {
    const ids = (Array.isArray(body.classrooms) ? body.classrooms : []).filter(isObjectId)
    if (!ids.length) throw new HttpError(400, 'Choose at least one class that takes this practical.')
    if ((await Classroom.countDocuments({ _id: { $in: ids } })) !== new Set(ids).size) throw new HttpError(400, 'One of those classes no longer exists.')
    settings.classrooms = [...new Set(ids)]
  }
  return settings
}

/** Subjects with their class names, experiment and student counts, and how much of it is solved. */
export async function withSubjectStats(subjects: SubjectDoc[]) {
  const ids = subjects.map(s => s._id)
  const classIds = [...new Set(subjects.flatMap(s => s.classrooms.map(String)))]
  const [classes, experiments, students, solved] = await Promise.all([
    Classroom.find({ _id: { $in: classIds } }).lean(),
    Experiment.aggregate<{ _id: Types.ObjectId; count: number }>([{ $match: { subject: { $in: ids } } }, { $group: { _id: '$subject', count: { $sum: 1 } } }]),
    Student.aggregate<{ _id: Types.ObjectId; count: number }>([{ $match: { classroom: { $in: classIds.map(id => new Types.ObjectId(id)) }, activatedAt: { $ne: null } } }, { $group: { _id: '$classroom', count: { $sum: 1 } } }]),
    PracticalSubmission.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { subject: { $in: ids }, problem: null, solved: true } },
      { $group: { _id: { subject: '$subject', student: '$student', experiment: '$experiment' } } },
      { $group: { _id: '$_id.subject', count: { $sum: 1 } } },
    ]),
  ])
  const classById = new Map(classes.map(c => [String(c._id), c]))
  const experimentCount = new Map(experiments.map(e => [String(e._id), e.count]))
  const studentsInClass = new Map(students.map(s => [String(s._id), s.count]))
  const solvedCount = new Map(solved.map(s => [String(s._id), s.count]))
  return subjects.map(subject => {
    const studentCount = subject.classrooms.reduce((sum, id) => sum + (studentsInClass.get(String(id)) ?? 0), 0)
    const experimentTotal = experimentCount.get(String(subject._id)) ?? 0
    const possible = studentCount * experimentTotal
    return {
      id: String(subject._id),
      title: subject.title,
      code: subject.code ?? '',
      description: subject.description ?? '',
      classrooms: subject.classrooms.map(String),
      classLabels: subject.classrooms.map(id => classLabel(classById.get(String(id)))).filter(Boolean),
      experiments: experimentTotal,
      students: studentCount,
      completionPercent: possible ? Math.round(((solvedCount.get(String(subject._id)) ?? 0) / possible) * 100) : null,
      createdAt: subject.createdAt ?? null,
    }
  })
}


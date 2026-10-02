import 'server-only'
import type { Types } from 'mongoose'
import { evaluateCode } from './code-runs'
import { Experiment, LANGUAGES, PracticalSubmission, classLabel } from './models'
import { levels, serializeProblem, solvedExperiments, type ProblemDoc } from './practicals'
import type { PracticalReport, ReportEntry } from './practical-types'

// Practical reports (the lab journal PDF): for each experiment, the problem, the student's latest code and
// what it printed on the sample inputs. Built even when nothing was submitted or the code doesn't compile,
// so a report can always be printed.

type ReportStudent = {
  _id: Types.ObjectId
  name?: string | null
  officialEmail?: string | null
  rollNumber?: string | null
  classroom?: unknown
}

type ReportSubject = { _id: Types.ObjectId; title: string; code?: string | null }

type PracticeDoc = ProblemDoc & { source: 'faculty' | 'ai' }

/** Runs code on the sample inputs for the report. Never throws: a runner failure becomes a note. */
async function execute(language: string, code: string, samples: { input: string; output: string }[]): Promise<ReportEntry['execution']> {
  if (!code.trim()) return { compileError: '', results: [], note: 'No code was written.' }
  if (!(LANGUAGES as readonly string[]).includes(language)) return { compileError: '', results: [], note: 'The code is in an unsupported language, so it was not run.' }
  if (!samples.length) return { compileError: '', results: [], note: 'This problem has no sample inputs to run.' }
  try {
    const result = await evaluateCode(language, code, samples.map(s => ({ input: s.input, expectedOutput: s.output })))
    return { compileError: result.compileError ?? '', results: result.testResults ?? [], note: '' }
  } catch {
    return { compileError: '', results: [], note: 'The code runner was not available when this report was made, so the output is not shown.' }
  }
}

async function entry({ subject, student, experiment, practice, locked, draft }: {
  subject: ReportSubject
  student: ReportStudent
  experiment: ProblemDoc & { order: number }
  practice: PracticeDoc | null
  locked: boolean
  draft?: { language: string; code: string } | null
}): Promise<ReportEntry> {
  const base = { order: experiment.order, title: experiment.title, practice: practice ? { title: practice.title, source: practice.source } : null }
  if (locked) {
    // Readable (the aim and sample tests), but nothing to run yet.
    const problem = serializeProblem(experiment, { withHidden: false })
    return {
      ...base,
      problem: { text: problem.text, inputFormat: problem.inputFormat, outputFormat: problem.outputFormat, constraints: problem.constraints, samples: problem.samples },
      status: 'locked', attempts: 0, submittedAt: null, solvedAt: null, score: null, code: null,
      execution: { compileError: '', results: [], note: 'Locked: this experiment opens once the previous one is solved.' },
    }
  }
  const filter = { subject: subject._id, experiment: experiment._id, student: student._id, problem: practice?._id ?? null }
  const [latest, attempts, firstSolved] = await Promise.all([
    PracticalSubmission.findOne(filter).sort({ createdAt: -1 }).lean(),
    PracticalSubmission.countDocuments(filter),
    PracticalSubmission.findOne({ ...filter, solved: true }).sort({ createdAt: 1 }).select('createdAt').lean(),
  ])
  const problem = serializeProblem(practice ?? experiment, { withHidden: false })
  const code = latest ? { language: latest.language, text: latest.code, draft: false }
    : draft?.code.trim() ? { language: draft.language, text: draft.code, draft: true }
      : null
  return {
    ...base,
    problem: { text: problem.text, inputFormat: problem.inputFormat, outputFormat: problem.outputFormat, constraints: problem.constraints, samples: problem.samples },
    status: !latest ? 'not_submitted' : latest.solved ? 'solved' : latest.compileError ? 'compile_error' : 'not_solved',
    attempts,
    submittedAt: latest ? latest.createdAt.toISOString() : null,
    solvedAt: firstSolved ? firstSolved.createdAt.toISOString() : null,
    score: latest ? { samplesPassed: latest.samplesPassed, samplesTotal: latest.samplesTotal, hiddenPassed: latest.hiddenPassed, hiddenTotal: latest.hiddenTotal } : null,
    code,
    execution: code ? await execute(code.language, code.text, problem.samples) : { compileError: '', results: [], note: 'Nothing was submitted for this experiment.' },
  }
}

/**
 * Builds a practical report for one student: one experiment (optionally one of its practice problems, and
 * the student's unsubmitted draft when there's no submission) or, with no `experimentId`, every experiment.
 * `hideLocked` marks experiments the student hasn't unlocked as locked: their aim is printed, but no code or output.
 */
export async function buildPracticalReport({ subject, student, experimentId, practice = null, draft = null, hideLocked }: {
  subject: ReportSubject
  student: ReportStudent
  experimentId?: Types.ObjectId | string
  practice?: PracticeDoc | null
  draft?: { language: string; code: string } | null
  hideLocked: boolean
}): Promise<PracticalReport> {
  const [experiments, solved] = await Promise.all([
    Experiment.find({ subject: subject._id }).sort({ order: 1 }).lean(),
    hideLocked ? solvedExperiments(subject._id, student._id) : Promise.resolve(new Set<string>()),
  ])
  const status = new Map(levels(experiments, solved).map(l => [String(l.experiment._id), l.status]))
  const targets = experimentId ? experiments.filter(e => String(e._id) === String(experimentId)) : experiments

  // One at a time, so a long report doesn't flood the code runner.
  const entries: ReportEntry[] = []
  for (const experiment of targets) {
    const locked = hideLocked && status.get(String(experiment._id)) === 'locked'
    entries.push(await entry({ subject, student, experiment, practice: experimentId ? practice : null, locked, draft: experimentId ? draft : null }))
  }

  return {
    generatedAt: new Date().toISOString(),
    student: {
      name: student.name || student.officialEmail || 'Student',
      rollNumber: student.rollNumber ?? '',
      email: student.officialEmail ?? '',
      classLabel: classLabel(student.classroom && typeof student.classroom === 'object' ? student.classroom as { class?: string; branch?: string; division?: string } : null),
    },
    subject: { title: subject.title, code: subject.code ?? '' },
    entries,
  }
}

import { NextResponse } from 'next/server'
import { handler, requireTeacher } from '@/lib/auth'
import { isAnswered, submitIfExpired } from '@/lib/exams'
import { Attempt, Student, classLabel } from '@/lib/models'
import { findTeacherRoom } from '@/lib/rooms'
import { INTEGRITY_EVENTS, INTEGRITY_EVENT_TYPES, RISK_META, normalizeFlags, riskOf, violationCount } from '@/lib/integrity'

type Context = { params: Promise<{ id: string }> }

/**
 * GET /api/rooms/:id/attempts — every participant, ranked (leaderboard) with live progress.
 * Add ?format=csv to download for Excel.
 */
export const GET = handler(async (request: Request, context: Context) => {
  const teacher = await requireTeacher()
  const room = await findTeacherRoom(teacher._id, (await context.params).id)

  const attempts = await Attempt.find({ room: room._id })
  for (const attempt of attempts) await submitIfExpired(attempt)

  const students = await Student.find({ _id: { $in: attempts.map(a => a.student).filter(Boolean) } }).populate('classroom').select('name rollNumber prn classroom').lean()
  const studentById = new Map(students.map(s => [String(s._id), s]))

  const rows = attempts.map(a => {
    const student = a.student ? studentById.get(String(a.student)) : undefined
    const classroom = student?.classroom as { class?: string; branch?: string; division?: string } | undefined
    const finishedAt = a.submittedAt ?? null
    const flags = normalizeFlags(a.flags, a.tabSwitches)
    const risk = riskOf(flags)
    return {
      id: String(a._id),
      studentName: student?.name || a.studentName || a.studentEmail || 'Student',
      studentEmail: a.studentEmail ?? '',
      rollNumber: student?.rollNumber || a.rollNumber || '',
      className: classLabel(classroom),
      status: a.status,
      answered: a.answers.filter(isAnswered).length,
      totalQuestions: a.questions.length,
      correctCount: a.correctCount,
      wrongCount: a.wrongCount ?? 0,
      mcqScore: a.mcqScore ?? a.score,
      codingScore: a.codingScore ?? 0,
      codingPending: a.codingPending ?? 0,
      score: a.score,
      maxScore: a.maxScore || a.questions.length * a.marksPerQuestion,
      tabSwitches: a.tabSwitches ?? 0,
      flags,
      violations: violationCount(flags),
      risk: risk.level,
      riskScore: risk.score,
      ipCount: a.ipAddresses?.length ?? 0,
      autoSubmitted: a.autoSubmitted ?? false,
      autoSubmitReason: a.autoSubmitReason ?? '',
      startedAt: a.startedAt,
      endsAt: a.endsAt,
      submittedAt: finishedAt,
      lastSeenAt: a.lastSeenAt ?? a.updatedAt,
      timeTakenSeconds: finishedAt ? Math.round((finishedAt.getTime() - a.startedAt.getTime()) / 1000) : null,
    }
  })
  // Leaderboard order: submitted first, highest score, then fastest.
  rows.sort((x, y) =>
    Number(y.status === 'submitted') - Number(x.status === 'submitted') ||
    y.score - x.score ||
    (x.timeTakenSeconds ?? Infinity) - (y.timeTakenSeconds ?? Infinity))
  let rank = 0
  const ranked = rows.map((row, index) => {
    if (row.status === 'submitted') rank = index > 0 && rows[index - 1].score === row.score && rows[index - 1].status === 'submitted' ? rank : index + 1
    return { ...row, rank: row.status === 'submitted' ? rank : null }
  })

  if (new URL(request.url).searchParams.get('format') === 'csv') {
    const header = ['Rank', 'Name', 'Email', 'Roll number', 'Class', 'Status', 'Answered', 'MCQ correct', 'MCQ wrong', 'MCQ score', 'Coding score', 'Coding to grade', 'Total', 'Max', 'Percent', 'Time taken (min)', 'Integrity', 'Violations', ...INTEGRITY_EVENT_TYPES.map(t => INTEGRITY_EVENTS[t].label), 'Submitted at']
    const lines = ranked.map(r => [
      r.rank ?? '', r.studentName, r.studentEmail, r.rollNumber, r.className,
      r.status === 'submitted' ? (r.autoSubmitted ? `Auto-submitted (${{ time: 'time up', violations: 'too many violations', faculty: 'by faculty', room_closed: 'exam ended' }[r.autoSubmitReason as string] ?? 'time up'})` : 'Submitted') : 'Writing',
      `${r.answered}/${r.totalQuestions}`, r.correctCount, r.wrongCount, r.mcqScore, r.codingScore, r.codingPending, r.score, r.maxScore,
      r.maxScore ? `${Math.round((r.score / r.maxScore) * 100)}%` : '',
      r.timeTakenSeconds == null ? '' : (r.timeTakenSeconds / 60).toFixed(1),
      RISK_META[r.risk].label,
      r.violations,
      ...INTEGRITY_EVENT_TYPES.map(t => r.flags[t] ?? 0),
      r.submittedAt ? new Date(r.submittedAt).toLocaleString('en-IN') : '',
    ])
    const csv = '﻿' + [header, ...lines].map(line => line.map(csvCell).join(',')).join('\r\n')
    const fileName = `${room.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'exam'}-results.csv`
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileName}"` } })
  }

  return NextResponse.json({ attempts: ranked })
})

function csvCell(value: unknown) {
  let text = String(value ?? '')
  // Stop spreadsheet formula injection from student-entered names.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

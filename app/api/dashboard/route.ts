import { NextResponse } from 'next/server'
import { handler, requireTeacher } from '@/lib/auth'
import { Attempt, ExamRoom, Question, Student } from '@/lib/models'
import { withRoomStats } from '@/lib/rooms'

/** GET /api/dashboard — numbers and lists for the teacher overview. */
export const GET = handler(async () => {
  const teacher = await requireTeacher()
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)

  const rooms = await ExamRoom.find({ teacher: teacher._id }).select('-pool').sort({ createdAt: -1 }).lean()
  const roomIds = rooms.map(room => room._id)

  const [questionTotal, questionsThisWeek, topics, studentsThisMonth, attemptTotals, recentAttempts, recentQuestions, roomStats, studentsTotal, studentsActive, pendingReview] = await Promise.all([
    Question.countDocuments({ teacher: teacher._id }),
    Question.countDocuments({ teacher: teacher._id, createdAt: { $gte: weekAgo } }),
    Question.distinct('topic', { teacher: teacher._id, topic: { $nin: ['', null] } }),
    Attempt.distinct('studentEmail', { room: { $in: roomIds }, createdAt: { $gte: monthStart } }),
    Attempt.aggregate<{ joined: number; submitted: number; inProgress: number }>([
      { $match: { room: { $in: roomIds } } },
      { $group: { _id: null, joined: { $sum: 1 }, submitted: { $sum: { $cond: [{ $eq: ['$status', 'submitted'] }, 1, 0] } }, inProgress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } } } },
    ]),
    Attempt.find({ room: { $in: roomIds }, status: 'submitted' }).sort({ submittedAt: -1 }).limit(5).select('room studentName studentEmail score maxScore submittedAt').lean(),
    Question.aggregate<{ _id: { source: string; room: unknown }; count: number; at: Date }>([
      { $match: { teacher: teacher._id } },
      { $sort: { createdAt: -1 } },
      { $limit: 500 },
      { $group: { _id: { source: '$source', room: '$room', minute: { $dateTrunc: { date: '$createdAt', unit: 'minute' } } }, count: { $sum: 1 }, at: { $max: '$createdAt' } } },
      { $sort: { at: -1 } },
      { $limit: 5 },
    ]),
    withRoomStats(rooms),
    Student.countDocuments(),
    Student.countDocuments({ activatedAt: { $exists: true, $ne: null } }),
    Attempt.countDocuments({ room: { $in: roomIds }, status: 'submitted', codingPending: { $gt: 0 } }),
  ])

  const titleById = new Map(rooms.map(room => [String(room._id), room.title]))
  const activity = [
    ...recentQuestions.map(group => ({
      kind: group._id.source === 'ai' ? 'ai' : group._id.source === 'csv' ? 'import' : 'manual',
      title: `${group.count} question${group.count === 1 ? '' : 's'} ${group._id.source === 'ai' ? 'generated with AI' : group._id.source === 'csv' ? 'imported from CSV' : 'added'}`,
      detail: group._id.room ? `Exam room · ${titleById.get(String(group._id.room)) ?? 'deleted room'}` : 'Question bank',
      at: group.at,
    })),
    ...recentAttempts.map(attempt => ({
      kind: 'attempt',
      title: `${attempt.studentName || attempt.studentEmail || 'A student'} submitted`,
      detail: `${titleById.get(String(attempt.room)) ?? 'Exam'} · ${attempt.score}/${attempt.maxScore}`,
      at: attempt.submittedAt,
    })),
  ].sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime()).slice(0, 6)

  const totals = attemptTotals[0] ?? { joined: 0, submitted: 0, inProgress: 0 }
  return NextResponse.json({
    teacher: { name: teacher.name, email: teacher.email, department: teacher.department ?? '' },
    stats: {
      questionTotal,
      questionsThisWeek,
      topicCount: topics.length,
      openRooms: rooms.filter(room => room.status === 'open').length,
      studentsTakingNow: totals.inProgress,
      completionPercent: totals.joined ? Math.round((totals.submitted / totals.joined) * 100) : null,
      studentsThisMonth: studentsThisMonth.filter(Boolean).length,
      studentsTotal,
      studentsActive,
      pendingReview,
      totalRooms: rooms.length,
    },
    rooms: roomStats,
    activity,
  })
})

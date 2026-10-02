import { NextResponse } from 'next/server'
import type { Types } from 'mongoose'
import { handler, requireTeacher } from '@/lib/auth'
import { ExamRoom, Question } from '@/lib/models'

/** GET /api/questions/groups — the teacher's question bank grouped by exam room (plus "not in a room"). */
export const GET = handler(async () => {
  const teacher = await requireTeacher()
  const groups = await Question.aggregate<{ _id: Types.ObjectId | null; total: number; mcq: number; tf: number; coding: number; lastAdded: Date; topics: string[]; sources: string[] }>([
    { $match: { teacher: teacher._id } },
    {
      $group: {
        _id: '$room',
        total: { $sum: 1 },
        mcq: { $sum: { $cond: [{ $eq: ['$type', 'mcq'] }, 1, 0] } },
        tf: { $sum: { $cond: [{ $eq: ['$type', 'tf'] }, 1, 0] } },
        coding: { $sum: { $cond: [{ $eq: ['$type', 'coding'] }, 1, 0] } },
        lastAdded: { $max: '$createdAt' },
        topics: { $addToSet: '$topic' },
        sources: { $addToSet: '$source' },
      },
    },
    { $sort: { lastAdded: -1 } },
  ])
  const rooms = new Map((await ExamRoom.find({ _id: { $in: groups.map(g => g._id).filter(Boolean) }, teacher: teacher._id })
    .select('title code status durationMinutes questionsPerStudent tfQuestions codingQuestions marksPerQuestion negativeMarks codingMarks description').lean()).map(r => [String(r._id), r]))

  return NextResponse.json({
    groups: groups.map(g => {
      const room = g._id ? rooms.get(String(g._id)) : undefined
      return {
        key: g._id ? String(g._id) : 'unassigned',
        room: room ? {
          id: String(room._id), title: room.title, code: room.code, status: room.status, description: room.description ?? '',
          durationMinutes: room.durationMinutes, questionsPerStudent: room.questionsPerStudent, tfQuestions: room.tfQuestions ?? 0, codingQuestions: room.codingQuestions ?? 0,
          marksPerQuestion: room.marksPerQuestion, negativeMarks: room.negativeMarks ?? 0, codingMarks: room.codingMarks ?? 10,
        } : null,
        total: g.total,
        mcq: g.mcq,
        tf: g.tf,
        coding: g.coding,
        lastAdded: g.lastAdded,
        topics: g.topics.filter(Boolean).slice(0, 6),
        sources: g.sources.filter(Boolean),
      }
    }),
  })
})

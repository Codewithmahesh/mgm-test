import mongoose, { Schema, type InferSchemaType, type Model, Types } from 'mongoose'
import { BLOOM_LEVELS } from './bloom'

// Field names match the documents already stored in the `examly` database,
// so existing teachers, students, rooms, questions and attempts keep working.

const teacherSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    department: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
)

export const YEARS = ['FY', 'SY', 'TY', 'B.Tech'] as const
export const YEAR_LABELS: Record<string, string> = { FY: 'First Year (FY)', SY: 'Second Year (SY)', TY: 'Third Year (TY)', 'B.Tech': 'B.Tech', LY: 'B.Tech' }
export const BRANCHES: Record<string, string> = {
  CSE: 'COMPUTER SCIENCE & ENGINEERING (B.Tech)',
  AIML: 'Artificial Intelligence & Machine Learning (B.Tech)',
  IT: 'Information Technology (B.Tech)',
  ENTC: 'Electronics & Telecommunication (B.Tech)',
  MECH: 'Mechanical Engineering (B.Tech)',
  CIVIL: 'Civil Engineering (B.Tech)',
  EE: 'Electrical Engineering (B.Tech)',
}

export const DEPARTMENTS = [
  'Computer Science & Engineering',
  'Artificial Intelligence & Machine Learning',
  'Information Technology',
  'Electronics & Telecommunication Engineering',
  'Mechanical Engineering',
  'Civil Engineering',
  'Electrical Engineering',
  'Basic Sciences & Humanities',
] as const

const classroomSchema = new Schema(
  {
    class: String,
    branch: String,
    division: String,
    branchName: String,
  },
  { timestamps: true, autoIndex: false },
)

// The student list. Faculty add a college email; the student activates it with an OTP,
// sets a password and completes their profile.
const studentSchema = new Schema(
  {
    officialEmail: { type: String, lowercase: true, trim: true },
    name: { type: String, default: '' },
    studentCode: String,
    rollNumber: String,
    prn: String,
    enrollmentNumber: String,
    gender: String,
    classroom: { type: Schema.Types.ObjectId, ref: 'Classroom' },
    starred: { type: Boolean, default: false },
    passwordHash: String,
    activatedAt: Date,
    profileCompletedAt: Date,
    addedBy: { type: Schema.Types.ObjectId, ref: 'Teacher' },
  },
  // The collection already has its own indexes (see scripts/migrate.mjs); don't let Mongoose redefine them.
  { timestamps: true, autoIndex: false },
)

export const QUESTION_TYPES = ['mcq', 'tf', 'coding'] as const
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export const LANGUAGES = ['cpp', 'c', 'java', 'python', 'javascript'] as const

const sampleSchema = new Schema({ input: { type: String, default: '' }, output: { type: String, default: '' }, explanation: { type: String, default: '' } }, { _id: false })

const questionSchema = new Schema(
  {
    teacher: { type: Schema.Types.ObjectId, ref: 'Teacher', index: true },
    // The exam room whose pool this question belongs to. Unassigned questions live only in the bank.
    room: { type: Schema.Types.ObjectId, ref: 'ExamRoom', default: null },
    type: { type: String, enum: QUESTION_TYPES, default: 'mcq' },
    // MCQ: the question. Coding: the problem statement.
    text: { type: String, required: true, trim: true },
    options: { type: [String], default: [] },
    correctIndex: { type: Number, default: null },
    topic: { type: String, trim: true, default: '' },
    // Legacy easy/medium/hard; replaced by Bloom's taxonomy level.
    difficulty: { type: String, enum: [...DIFFICULTIES, null], default: null },
    bloom: { type: String, enum: [...BLOOM_LEVELS, null], default: null },
    // Question set label ("A", "B"…). Empty = common to every set. Exposed as `set` in the API;
    // not stored as `set`, which would shadow Mongoose's document.set().
    setLabel: { type: String, trim: true, uppercase: true, default: '' },
    explanation: { type: String, default: '' },
    // Coding problems only
    title: { type: String, trim: true, default: '' },
    inputFormat: { type: String, default: '' },
    outputFormat: { type: String, default: '' },
    constraints: { type: String, default: '' },
    samples: { type: [sampleSchema], default: [] },
    points: { type: Number, default: null },
    language: { type: String, default: '' },
    starterCode: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    source: { type: String, enum: ['csv', 'ai', 'manual'], default: 'manual' },
  },
  { timestamps: true },
)
questionSchema.index({ room: 1, type: 1 })
questionSchema.index({ teacher: 1, createdAt: -1 })

export const ROOM_STATUSES = ['draft', 'open', 'closed'] as const
export const RESULT_VISIBILITY = ['after_submit', 'after_end', 'never'] as const
export const PAPER_MODES = ['random', 'sets'] as const

const bloomPlanSchema = new Schema({ level: { type: String, enum: BLOOM_LEVELS, required: true }, count: { type: Number, min: 0, default: 0 }, marks: { type: Number, min: 0, default: 1 } }, { _id: false })

const examRoomSchema = new Schema(
  {
    teacher: { type: Schema.Types.ObjectId, ref: 'Teacher', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    instructions: { type: String, default: '' },
    code: { type: String, required: true, unique: true, uppercase: true },
    // MCQ / true-false questions each student gets
    questionsPerStudent: { type: Number, required: true, min: 0 },
    // Coding problems each student gets
    codingQuestions: { type: Number, default: 0, min: 0 },
    marksPerQuestion: { type: Number, default: 1, min: 0 },
    negativeMarks: { type: Number, default: 0, min: 0 },
    codingMarks: { type: Number, default: 10, min: 0 },
    durationMinutes: { type: Number, required: true, min: 1 },
    startsAt: { type: Date, default: null },
    status: { type: String, enum: ROOM_STATUSES, default: 'draft' },
    showResults: { type: String, enum: RESULT_VISIBILITY, default: 'after_end' },
    // Empty = any activated student with the code can join.
    allowedClassrooms: { type: [Schema.Types.ObjectId], default: [] },
    // Proctoring
    requireFullscreen: { type: Boolean, default: true },
    blockCopyPaste: { type: Boolean, default: true },
    // Auto-submit once a student reaches this many violations (0 = never).
    maxViolations: { type: Number, default: 0, min: 0 },
    // Waiting room: students request to join and faculty admit them before they can start.
    requireApproval: { type: Boolean, default: true },
    // random: each student gets a random paper from the whole pool. sets: each student gets one question set.
    paperMode: { type: String, enum: PAPER_MODES, default: 'random' },
    // Sets mode: how many sets (A, B, C…); each set is a full paper.
    setCount: { type: Number, default: 0, min: 0 },
    // MCQs per Bloom level on every paper, with marks per question for that level.
    // Empty = levels balanced automatically, every question at marksPerQuestion.
    bloomPlan: { type: [bloomPlanSchema], default: [] },
    // Shuffled question ids, dealt round-robin so every question gets used evenly.
    pool: { type: [Schema.Types.ObjectId], default: [] },
    dealt: { type: Number, default: 0 },
    endedAt: Date,
  },
  { timestamps: true },
)
examRoomSchema.index({ teacher: 1, createdAt: -1 })

const integrityEventSchema = new Schema({ type: String, at: { type: Date, default: Date.now }, detail: { type: String, default: '' } }, { _id: false })

const codingMarkSchema = new Schema({ question: Schema.Types.ObjectId, marks: Number, feedback: { type: String, default: '' } }, { _id: false })

const attemptSchema = new Schema(
  {
    room: { type: Schema.Types.ObjectId, ref: 'ExamRoom', required: true },
    student: { type: Schema.Types.ObjectId, ref: 'Student', default: undefined },
    studentEmail: { type: String, lowercase: true, trim: true },
    studentName: { type: String, default: '' },
    rollNumber: { type: String, default: '' },
    questions: { type: [Schema.Types.ObjectId], default: [] },
    // Per question: option index for MCQ/TF, { language, code } for coding, null if unanswered.
    answers: { type: [Schema.Types.Mixed], default: [] },
    flagged: { type: [Number], default: [] },
    status: { type: String, enum: ['in_progress', 'submitted'], default: 'in_progress' },
    startedAt: { type: Date, default: Date.now },
    endsAt: { type: Date, required: true },
    submittedAt: Date,
    autoSubmitted: { type: Boolean, default: false },
    marksPerQuestion: { type: Number, default: 1 },
    // Marks for each question on this paper (same order as `questions`); falls back to marksPerQuestion.
    questionMarks: { type: [Number], default: [] },
    // Question set this paper came from ("A", "B"…). Shown to the student only after submitting.
    setLabel: { type: String, default: '' },
    negativeMarks: { type: Number, default: 0 },
    maxScore: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    wrongCount: { type: Number, default: 0 },
    mcqScore: { type: Number, default: 0 },
    codingScore: { type: Number, default: 0 },
    codingMarks: { type: [codingMarkSchema], default: [] },
    codingPending: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
    tabSwitches: { type: Number, default: 0 },
    // Proctoring: count per signal (see lib/integrity.ts) and a capped timeline.
    flags: { type: Map, of: Number, default: {} },
    events: { type: [integrityEventSchema], default: [] },
    // Only the most recently opened tab/device may write answers.
    sessionKey: { type: String, default: '' },
    // Browser-tab id of the active session; a refresh keeps it, a new tab or device doesn't.
    sessionTab: { type: String, default: '' },
    ipAddresses: { type: [String], default: [] },
    userAgent: { type: String, default: '' },
    autoSubmitReason: { type: String, enum: ['', 'time', 'violations', 'faculty', 'room_closed'], default: '' },
    lastSeenAt: Date,
  },
  { timestamps: true },
)
attemptSchema.index({ room: 1, studentEmail: 1 }, { unique: true, partialFilterExpression: { studentEmail: { $type: 'string' } } })
attemptSchema.index({ room: 1, status: 1 })
attemptSchema.index({ student: 1, createdAt: -1 })

export const JOIN_STATUSES = ['pending', 'admitted', 'rejected'] as const

// A student's request to enter a room's waiting room, decided by the faculty.
const joinRequestSchema = new Schema(
  {
    room: { type: Schema.Types.ObjectId, ref: 'ExamRoom', required: true },
    student: { type: Schema.Types.ObjectId, ref: 'Student' },
    studentEmail: { type: String, required: true, lowercase: true, trim: true },
    studentName: { type: String, default: '' },
    rollNumber: { type: String, default: '' },
    className: { type: String, default: '' },
    status: { type: String, enum: JOIN_STATUSES, default: 'pending' },
    requestedAt: { type: Date, default: Date.now },
    decidedAt: Date,
  },
  { timestamps: true },
)
joinRequestSchema.index({ room: 1, studentEmail: 1 }, { unique: true })
joinRequestSchema.index({ room: 1, status: 1, requestedAt: 1 })

const passwordResetSchema = new Schema({
  _id: { type: String },
  role: { type: String, default: 'teacher' },
  purpose: { type: String, default: 'reset' },
  account: { type: Schema.Types.ObjectId, required: true },
  otpHash: String,
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
})

const rateLimitSchema = new Schema({
  _id: { type: String },
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
})

function model<T extends Schema>(name: string, schema: T) {
  // In development, hot reload re-runs this file; rebuild the model so schema edits take effect.
  if (process.env.NODE_ENV !== 'production' && mongoose.models[name]) mongoose.deleteModel(name)
  return (mongoose.models[name] as Model<InferSchemaType<T>>) ?? mongoose.model(name, schema)
}

export const Teacher = model('Teacher', teacherSchema)
export const Classroom = model('Classroom', classroomSchema)
export const Student = model('Student', studentSchema)
export const Question = model('Question', questionSchema)
export const ExamRoom = model('ExamRoom', examRoomSchema)
export const Attempt = model('Attempt', attemptSchema)
export const PasswordReset = model('PasswordReset', passwordResetSchema)
export const JoinRequest = model('JoinRequest', joinRequestSchema)
export const RateLimit = model('RateLimit', rateLimitSchema)

export type QuestionDoc = InferSchemaType<typeof questionSchema> & { _id: Types.ObjectId }

export function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && Types.ObjectId.isValid(value) && String(new Types.ObjectId(value)) === value
}

export function classLabel(classroom?: { class?: string | null; branch?: string | null; division?: string | null } | null) {
  if (!classroom) return ''
  const year = classroom.class === 'LY' ? 'B.Tech' : classroom.class
  return [year, classroom.branch, classroom.division].filter(Boolean).join(' ')
}

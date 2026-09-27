// One-time, non-destructive upgrade of data created by the earlier backend.
// Run with: npm run db:migrate
//  - gives every question an owning `teacher` (taken from its exam room) so it shows in the question bank
//  - renames legacy question `set` fields to `setLabel` (avoids shadowing Mongoose's document.set())
//  - lets faculty add students by email only (studentCode no longer required)
//  - replaces the old unique (room, student) attempt index, which blocked students who aren't on the roster,
//    with a unique (room, studentEmail) index
import mongoose from 'mongoose'

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not set. Run this with: npm run db:migrate')
  process.exit(1)
}

await mongoose.connect(process.env.MONGODB_URI)
const db = mongoose.connection.db

const rooms = await db.collection('examrooms').find({}, { projection: { teacher: 1 } }).toArray()
let backfilled = 0
for (const room of rooms) {
  const result = await db.collection('questions').updateMany({ room: room._id, teacher: { $exists: false } }, { $set: { teacher: room.teacher } })
  backfilled += result.modifiedCount
}
console.log(`Questions linked to their teacher: ${backfilled}`)

const legacySetLabels = await db.collection('questions').updateMany(
  {
    set: { $exists: true },
    $or: [{ setLabel: { $exists: false } }, { setLabel: null }, { setLabel: '' }],
  },
  { $rename: { set: 'setLabel' } },
)
const staleSetFields = await db.collection('questions').updateMany(
  { set: { $exists: true } },
  { $unset: { set: '' } },
)
console.log(`Question set labels migrated: ${legacySetLabels.modifiedCount + staleSetFields.modifiedCount}`)

const orphans = await db.collection('questions').countDocuments({ teacher: { $exists: false } })
if (orphans) console.log(`Questions whose room no longer exists (left untouched): ${orphans}`)

const indexes = await db.collection('attempts').indexes()
if (indexes.some(index => index.name === 'room_1_student_1')) {
  await db.collection('attempts').dropIndex('room_1_student_1')
  console.log('Dropped old attempts index room_1_student_1')
}
if (!indexes.some(index => index.name === 'room_1_studentEmail_1')) {
  await db.collection('attempts').createIndex({ room: 1, studentEmail: 1 }, { unique: true, partialFilterExpression: { studentEmail: { $type: 'string' } } })
  console.log('Created attempts index room_1_studentEmail_1')
}

// Students added by faculty have only an email, so studentCode must be unique only when present.
const studentIndexes = await db.collection('students').indexes()
const codeIndex = studentIndexes.find(index => index.name === 'studentCode_1')
if (codeIndex && !codeIndex.partialFilterExpression) {
  await db.collection('students').dropIndex('studentCode_1')
  await db.collection('students').createIndex({ studentCode: 1 }, { unique: true, partialFilterExpression: { studentCode: { $type: 'string' } } })
  console.log('Made students.studentCode unique only when present')
}

await mongoose.disconnect()
console.log('Done.')

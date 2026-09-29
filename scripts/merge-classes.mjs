import mongoose from 'mongoose'

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not set. Run with: node --env-file-if-exists=.env scripts/merge-classes.mjs')
  process.exit(1)
}

await mongoose.connect(process.env.MONGODB_URI)
const db = mongoose.connection.db

console.log('--- Checking for duplicate or legacy classrooms ---')

// 1. Find all classrooms
const classrooms = await db.collection('classrooms').find({}).toArray()
console.log(`Found ${classrooms.length} total classrooms.`)

// Map 'LY' to 'B.Tech'
const lyRooms = classrooms.filter(c => c.class === 'LY')

for (const lyRoom of lyRooms) {
  console.log(`Found legacy classroom LY: ${lyRoom.branch} ${lyRoom.division} (_id: ${lyRoom._id})`)
  
  // Find matching B.Tech classroom
  let btechRoom = classrooms.find(
    c => c.class === 'B.Tech' && c.branch === lyRoom.branch && c.division === lyRoom.division && String(c._id) !== String(lyRoom._id)
  )

  if (!btechRoom) {
    console.log(`Renaming LY classroom to B.Tech directly...`)
    await db.collection('classrooms').updateOne({ _id: lyRoom._id }, { $set: { class: 'B.Tech' } })
    continue
  }

  console.log(`Found target B.Tech classroom (_id: ${btechRoom._id}). Merging...`)

  // Migrate students from lyRoom to btechRoom
  const studentRes = await db.collection('students').updateMany(
    { classroom: lyRoom._id },
    { $set: { classroom: btechRoom._id } }
  )
  console.log(`Moved ${studentRes.modifiedCount} students to target classroom.`)

  // Migrate examrooms allowedClassrooms
  const roomsWithOld = await db.collection('examrooms').find({ allowedClassrooms: lyRoom._id }).toArray()
  for (const r of roomsWithOld) {
    const updated = Array.from(new Set(r.allowedClassrooms.map(id => String(id) === String(lyRoom._id) ? btechRoom._id : id)))
    await db.collection('examrooms').updateOne({ _id: r._id }, { $set: { allowedClassrooms: updated } })
  }
  console.log(`Updated ${roomsWithOld.length} exam rooms.`)

  // Remove the old duplicate classroom
  await db.collection('classrooms').deleteOne({ _id: lyRoom._id })
  console.log(`Deleted duplicate classroom _id: ${lyRoom._id}`)
}

// 2. Check for any other identical classrooms (same class, branch, division)
const remaining = await db.collection('classrooms').find({}).toArray()
const seen = new Map()

for (const c of remaining) {
  const key = `${(c.class || '').trim()}-${(c.branch || '').trim()}-${(c.division || '').trim()}`
  if (!seen.has(key)) {
    seen.set(key, c)
  } else {
    const primary = seen.get(key)
    console.log(`Found duplicate classroom for ${key}: _id ${c._id} -> merging into _id ${primary._id}`)
    
    const studentRes = await db.collection('students').updateMany(
      { classroom: c._id },
      { $set: { classroom: primary._id } }
    )
    console.log(`Moved ${studentRes.modifiedCount} students.`)

    const roomsWithOld = await db.collection('examrooms').find({ allowedClassrooms: c._id }).toArray()
    for (const r of roomsWithOld) {
      const updated = Array.from(new Set(r.allowedClassrooms.map(id => String(id) === String(c._id) ? primary._id : id)))
      await db.collection('examrooms').updateOne({ _id: r._id }, { $set: { allowedClassrooms: updated } })
    }

    await db.collection('classrooms').deleteOne({ _id: c._id })
    console.log(`Deleted duplicate classroom _id: ${c._id}`)
  }
}

const finalCount = await db.collection('classrooms').countDocuments()
console.log(`Done! Now there are ${finalCount} unique classrooms.`)

await mongoose.disconnect()

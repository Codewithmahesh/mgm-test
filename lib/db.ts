import mongoose from 'mongoose'

type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null }

// Reuse one connection across hot reloads in dev and across requests on a warm server.
const globalForMongoose = globalThis as unknown as { mongooseCache?: Cache }
const cache: Cache = globalForMongoose.mongooseCache ?? { conn: null, promise: null }
globalForMongoose.mongooseCache = cache

export async function connectDb() {
  if (cache.conn) return cache.conn
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set. Add it to your .env file.')
  cache.promise ??= mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 })
  try {
    cache.conn = await cache.promise
  } catch (error) {
    cache.promise = null
    throw error
  }
  return cache.conn
}

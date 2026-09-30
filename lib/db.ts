import dns from 'node:dns'
import mongoose from 'mongoose'

type Cache = { promise: Promise<typeof mongoose> | null }

// Reuse one connection across hot reloads in dev and across requests on a warm server. The cache lives
// on the mongoose instance itself: Next.js can load a separate copy of mongoose for instrumentation.ts
// (the background scheduler), and that copy must open its own connection rather than assume the
// app's copy is connected.
const holder = mongoose as typeof mongoose & { examPortalCache?: Cache }
const cache: Cache = (holder.examPortalCache ??= { promise: null })

export async function connectDb() {
  if (mongoose.connection.readyState === 1) return mongoose
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set. Add it to your .env file.')
  cache.promise ??= usableDns(uri).then(() => mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 })).catch(error => {
    // mongodb+srv:// needs DNS lookups that some local resolvers (VPNs, DNS proxies on 127.0.0.1) refuse or
    // answer badly. Retry once through public DNS before giving up.
    console.warn('[db] connecting failed, retrying through public DNS:', error instanceof Error ? error.message : error)
    dns.setServers(['8.8.8.8', '1.1.1.1'])
    return mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 })
  })
  try {
    return await cache.promise
  } catch (error) {
    cache.promise = null
    throw error
  }
}

/**
 * mongodb+srv:// needs an SRV lookup, which some local resolvers (VPNs, DNS proxies on 127.0.0.1) refuse.
 * Check it first and switch this process to public DNS if it fails, so the first connection works.
 */
async function usableDns(uri: string) {
  const host = /^mongodb\+srv:\/\/(?:[^@/]*@)?([^/?]+)/.exec(uri)?.[1]
  if (!host) return
  try {
    await dns.promises.resolveSrv(`_mongodb._tcp.${host}`)
  } catch {
    dns.setServers(['8.8.8.8', '1.1.1.1'])
  }
}

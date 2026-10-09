import { NextResponse } from 'next/server'
import { HttpError, handler, rateLimit, signedInUser } from '@/lib/auth'
import { checkLeetcodeUsername, getLeetcode } from '@/lib/coding-stats'

/** Lookups per signed-in user per minute (shared with the GitHub lookup). */
const LOOKUPS_PER_MINUTE = 20

type Context = { params: Promise<{ username: string }> }

/** GET /api/coding-stats/leetcode/:username — LeetCode ranking and solved counts (mobile JEMS screens). */
export const GET = handler(async (_request: Request, context: Context) => {
  const user = await signedInUser()
  if (!user) throw new HttpError(401, 'Please sign in to continue.')
  const username = (await context.params).username.trim()
  checkLeetcodeUsername(username)
  await rateLimit(`coding-stats:${user.role}:${user.id}`, LOOKUPS_PER_MINUTE, 60)
  return NextResponse.json(await getLeetcode(username))
})

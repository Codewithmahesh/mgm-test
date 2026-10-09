import { NextResponse } from 'next/server'
import { HttpError, handler, rateLimit, signedInUser } from '@/lib/auth'
import { checkGithubUsername, getGithub } from '@/lib/coding-stats'

/** Lookups per signed-in user per minute; each one costs GitHub API calls from the server's shared quota. */
const LOOKUPS_PER_MINUTE = 20

type Context = { params: Promise<{ username: string }> }

/** GET /api/coding-stats/github/:username — a GitHub profile and its public repos (mobile JEMS screens). */
export const GET = handler(async (_request: Request, context: Context) => {
  const user = await signedInUser()
  if (!user) throw new HttpError(401, 'Please sign in to continue.')
  const username = (await context.params).username.trim()
  checkGithubUsername(username)
  await rateLimit(`coding-stats:${user.role}:${user.id}`, LOOKUPS_PER_MINUTE, 60)
  return NextResponse.json(await getGithub(username))
})

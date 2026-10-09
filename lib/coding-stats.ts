import 'server-only'
import { HttpError } from './auth'

// A student's public GitHub repos and LeetCode stats, for the mobile app's JEMS screens
// (application/src/lib/jems-sources.ts). Ported from the standalone `trial` Express server.

/**
 * Each lookup as a whole must finish in this time, well under the app's 30 s request timeout even after a
 * cold start, so the app always gets an answer it can show instead of "took too long".
 */
const LOOKUP_DEADLINE_MS = 15_000
const GITHUB_PAGE_SIZE = 100
/** The 300 most recently updated repos are plenty for a profile, and keep a lookup to a few GitHub calls. */
const GITHUB_MAX_PAGES = 3

const GITHUB_USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const LEETCODE_USERNAME = /^[A-Za-z0-9_.-]{1,40}$/

export function checkGithubUsername(username: string) {
  if (!GITHUB_USERNAME.test(username)) throw new HttpError(400, 'That is not a valid GitHub username.')
}

export function checkLeetcodeUsername(username: string) {
  if (!LEETCODE_USERNAME.test(username)) throw new HttpError(400, 'That is not a valid LeetCode username.')
}

/**
 * One request to GitHub or LeetCode, reading the whole body under the lookup's deadline. Network failures
 * and timeouts become 502/504 with the real cause in the server log.
 */
async function upstream<T>(url: string, init: RequestInit, deadline: AbortSignal, check: (response: Response) => void): Promise<T> {
  const started = Date.now()
  try {
    const response = await fetch(url, { ...init, cache: 'no-store', signal: deadline })
    check(response)
    return (await response.json()) as T
  } catch (error) {
    if (error instanceof HttpError) throw error
    const cause = error instanceof Error ? `${error.name}: ${error.message}${error.cause ? ` (${String(error.cause)})` : ''}` : String(error)
    console.error(`[coding-stats] ${init.method ?? 'GET'} ${url} failed after ${Date.now() - started} ms: ${cause}`)
    if (deadline.aborted) throw new HttpError(504, 'The stats provider took too long to answer. Try again in a moment.')
    throw new HttpError(502, 'Unable to reach the stats provider. Try again in a moment.')
  }
}

/* ---------------- GitHub ---------------- */

type GithubUser = {
  login: string
  name: string | null
  bio: string | null
  avatar_url: string
  html_url: string
  location: string | null
  company: string | null
  blog: string | null
  email: string | null
  public_repos: number
  followers: number
  following: number
  created_at: string
}

type GithubRepo = {
  name: string
  full_name: string
  description: string | null
  html_url: string
  clone_url: string
  homepage: string | null
  language: string | null
  topics?: string[]
  stargazers_count: number
  watchers_count: number
  forks_count: number
  open_issues_count: number
  size: number
  default_branch: string
  visibility: string
  private: boolean
  fork: boolean
  archived: boolean
  license: { spdx_id: string } | null
  created_at: string
  updated_at: string
  pushed_at: string | null
}

function githubJson<T>(url: string, deadline: AbortSignal): Promise<T> {
  const token = process.env.GITHUB_TOKEN?.trim()
  return upstream<T>(
    url,
    {
      headers: {
        'User-Agent': 'MGM-Exam-Portal',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
    deadline,
    (response) => {
      if (response.ok) return
      console.error(`[coding-stats] GitHub ${url} answered ${response.status} (rate limit left: ${response.headers.get('x-ratelimit-remaining') ?? '?'})`)
      if (response.status === 404) throw new HttpError(404, 'GitHub user not found.')
      if (response.status === 401) throw new HttpError(502, 'The server GitHub token is invalid. Ask the admin to update GITHUB_TOKEN.')
      if (response.status === 403 || response.status === 429) throw new HttpError(503, 'GitHub rate limit reached. Try again in a few minutes.')
      throw new HttpError(502, 'GitHub API request failed.')
    },
  )
}

async function publicRepos(username: string, deadline: AbortSignal) {
  const repos: GithubRepo[] = []
  for (let page = 1; page <= GITHUB_MAX_PAGES; page++) {
    const pageData = await githubJson<GithubRepo[]>(
      `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=${GITHUB_PAGE_SIZE}&sort=updated&page=${page}`,
      deadline,
    )
    if (!Array.isArray(pageData)) throw new HttpError(502, 'GitHub returned an unexpected response.')
    repos.push(...pageData.filter((repo) => !repo.private))
    if (pageData.length < GITHUB_PAGE_SIZE) break
  }
  return repos
}

export async function getGithub(username: string) {
  const deadline = AbortSignal.timeout(LOOKUP_DEADLINE_MS)
  const [user, repos] = await Promise.all([
    githubJson<GithubUser>(`https://api.github.com/users/${encodeURIComponent(username)}`, deadline),
    publicRepos(username, deadline),
  ])
  return {
    username: user.login,
    profile: {
      username: user.login,
      name: user.name,
      bio: user.bio,
      avatarUrl: user.avatar_url,
      profileUrl: user.html_url,
      location: user.location,
      company: user.company,
      blog: user.blog,
      email: user.email,
      publicRepos: user.public_repos,
      followers: user.followers,
      following: user.following,
      createdAt: user.created_at,
    },
    repos: repos.map((repo) => ({
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description,
      url: repo.html_url,
      cloneUrl: repo.clone_url,
      homepage: repo.homepage,
      language: repo.language,
      topics: repo.topics ?? [],
      stars: repo.stargazers_count,
      watchers: repo.watchers_count,
      forks: repo.forks_count,
      openIssues: repo.open_issues_count,
      size: repo.size,
      defaultBranch: repo.default_branch,
      visibility: repo.visibility,
      isFork: repo.fork,
      isArchived: repo.archived,
      license: repo.license?.spdx_id ?? null,
      createdAt: repo.created_at,
      updatedAt: repo.updated_at,
      pushedAt: repo.pushed_at,
    })),
  }
}

/* ---------------- LeetCode ---------------- */

const LEETCODE_QUERY = `
  query getUserProfile($username: String!) {
    matchedUser(username: $username) {
      username
      githubUrl
      twitterUrl
      linkedinUrl
      profile { ranking realName userAvatar aboutMe countryName company school websites }
      submitStatsGlobal { acSubmissionNum { difficulty count submissions } }
      tagProblemCounts {
        fundamental { tagName tagSlug problemsSolved }
        intermediate { tagName tagSlug problemsSolved }
        advanced { tagName tagSlug problemsSolved }
      }
      badges { id displayName icon creationDate }
      contributions { points questionCount }
    }
  }
`

type LeetcodeTag = { tagName: string; tagSlug: string; problemsSolved: number }

type LeetcodeUser = {
  username: string
  githubUrl: string | null
  twitterUrl: string | null
  linkedinUrl: string | null
  profile: {
    ranking: number | null
    realName: string | null
    userAvatar: string | null
    aboutMe: string | null
    countryName: string | null
    company: string | null
    school: string | null
    websites: string[] | null
  } | null
  submitStatsGlobal: { acSubmissionNum: { difficulty: string; count: number; submissions: number }[] } | null
  tagProblemCounts: { fundamental: LeetcodeTag[]; intermediate: LeetcodeTag[]; advanced: LeetcodeTag[] } | null
  badges: { id: string; displayName: string; icon: string; creationDate: string }[] | null
  contributions: { points: number; questionCount: number } | null
}

export async function getLeetcode(username: string) {
  const body = await upstream<{ data?: { matchedUser?: LeetcodeUser | null }; errors?: unknown[] }>(
    'https://leetcode.com/graphql',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'MGM-Exam-Portal', Referer: 'https://leetcode.com' },
      body: JSON.stringify({ query: LEETCODE_QUERY, variables: { username } }),
    },
    AbortSignal.timeout(LOOKUP_DEADLINE_MS),
    (response) => {
      if (!response.ok) throw new HttpError(502, 'LeetCode API request failed.')
    },
  )
  const user = body.data?.matchedUser
  // LeetCode answers an unknown username with a GraphQL error and a null user.
  if (!user) throw new HttpError(404, 'LeetCode user not found.')
  if (body.errors?.length) throw new HttpError(502, 'LeetCode returned an error.')

  return {
    username: user.username,
    profile: {
      ranking: user.profile?.ranking ?? null,
      realName: user.profile?.realName ?? null,
      avatarUrl: user.profile?.userAvatar ?? null,
      about: user.profile?.aboutMe ?? null,
      country: user.profile?.countryName ?? null,
      company: user.profile?.company ?? null,
      school: user.profile?.school ?? null,
      websites: user.profile?.websites ?? [],
      githubUrl: user.githubUrl ?? null,
      twitterUrl: user.twitterUrl ?? null,
      linkedinUrl: user.linkedinUrl ?? null,
    },
    ranking: user.profile?.ranking ?? null,
    solved: user.submitStatsGlobal?.acSubmissionNum ?? [],
    solvedByTopic: {
      fundamental: user.tagProblemCounts?.fundamental ?? [],
      intermediate: user.tagProblemCounts?.intermediate ?? [],
      advanced: user.tagProblemCounts?.advanced ?? [],
    },
    badges: user.badges ?? [],
    contributions: user.contributions ?? null,
  }
}

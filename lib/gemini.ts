import 'server-only'
import { HttpError } from './auth'

type Part = { text: string } | { inline_data: { mime_type: string; data: string } }

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

function models() {
  return (process.env.GEMINI_MODEL || 'gemini-3.5-flash')
    .split(',')
    .map(model => model.trim())
    .filter(Boolean)
}

/**
 * Calls Gemini and returns parsed JSON. Tries each model in GEMINI_MODEL in order,
 * moving on when one is rate limited, overloaded or unavailable.
 */
export async function generateJson<T>({ system, parts, schema }: { system: string; parts: Part[]; schema: object }): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new HttpError(500, 'GEMINI_API_KEY is not set on the server.')

  let lastError = ''
  for (const model of models()) {
    const response = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.7 },
      }),
    })

    if (response.ok) {
      const data = await response.json()
      const text: string = data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('') ?? ''
      try {
        return JSON.parse(text) as T
      } catch {
        lastError = `${model} returned malformed JSON`
        continue
      }
    }

    const body = await response.text()
    lastError = `${model}: ${response.status} ${body.slice(0, 200)}`
    // 429 rate limit, 5xx overload, 404 model not found: try the next model. Anything else is a real error.
    if (response.status === 429 || response.status >= 500 || response.status === 404) continue
    console.error('[gemini]', lastError)
    throw new HttpError(502, 'The AI service rejected the request. Check GEMINI_API_KEY and try again.')
  }

  console.error('[gemini] all models failed:', lastError)
  throw new HttpError(503, 'All AI models are busy right now. Please try again in a minute.')
}

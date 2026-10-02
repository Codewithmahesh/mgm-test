import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * AI-written problems sometimes arrive double-escaped, so "line 1\nline 2" is stored with a literal
 * backslash-n and shows (and is fed to stdin) as one line. Turns those escapes back into real line breaks
 * and tabs. Quoted escapes such as '\n' or "\t" are left alone, since a statement may be talking about them.
 */
export function unescapeText(text: string) {
  if (!text || !text.includes('\\')) return text
  return text
    .replace(/(?<!['"`\\])\\r\\n(?!['"`])/g, '\n')
    .replace(/(?<!['"`\\])\\n(?!['"`])/g, '\n')
    .replace(/(?<!['"`\\])\\t(?!['"`])/g, '\t')
}

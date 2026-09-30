'use client'

import { useCallback } from 'react'
import { useFeedback } from '@/components/ui/overlay'
import { gibberishWords } from '@/lib/gibberish'

/**
 * Before submitting a form: if any field looks like random typing, ask whether to continue anyway.
 * Resolves true to go ahead (nothing looked odd, or the person chose to continue).
 */
export function useGibberishCheck() {
  const { confirm } = useFeedback()
  return useCallback(async (fields: { label: string; value: string | null | undefined }[]) => {
    const odd = fields.map(field => ({ label: field.label, words: gibberishWords(field.value ?? '') })).filter(field => field.words.length)
    if (!odd.length) return true
    return confirm({
      title: "Some text doesn't look meaningful",
      description: (
        <>
          <span className="block">This looks like it might be a typo or random characters:</span>
          <span className="mt-2 flex flex-col gap-1">
            {odd.map(field => (
              <span key={field.label}><b className="font-semibold text-foreground">{field.label}</b>: {field.words.map(word => `“${word}”`).join(', ')}</span>
            ))}
          </span>
          <span className="mt-2 block">Do you still want to continue?</span>
        </>
      ),
      confirmLabel: 'Continue anyway',
      cancelLabel: 'Go back and edit',
    })
  }, [confirm])
}

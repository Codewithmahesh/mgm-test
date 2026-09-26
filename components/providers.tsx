'use client'

import { ThemeProvider } from '@/components/theme'
import { FeedbackProvider } from '@/components/ui/overlay'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <FeedbackProvider>{children}</FeedbackProvider>
    </ThemeProvider>
  )
}

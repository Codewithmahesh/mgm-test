'use client'

import { ThemeProvider } from '@/components/theme'
import { TopLoader } from '@/components/top-loader'
import { FeedbackProvider } from '@/components/ui/overlay'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TopLoader />
      <FeedbackProvider>{children}</FeedbackProvider>
    </ThemeProvider>
  )
}

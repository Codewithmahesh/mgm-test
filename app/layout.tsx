import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono, Source_Serif_4 } from 'next/font/google'
import { Providers } from '@/components/providers'
import { themeScript } from '@/lib/theme-script'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const serif = Source_Serif_4({ subsets: ['latin'], variable: '--font-serif-display', display: 'swap', weight: ['400', '500', '600'] })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' })

export const metadata: Metadata = {
  title: { default: "Online Examination Portal — MGM's College of Engineering, Nanded", template: '%s · MGM CoE Nanded' },
  description: "Online MCQ and coding examinations for MGM's College of Engineering, Nanded.",
  icons: {
    icon: [{ url: '/mgm-icon-32.png', sizes: '32x32', type: 'image/png' }, { url: '/mgm-logo.png', sizes: '256x256', type: 'image/png' }],
    apple: '/mgm-apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf9f5' },
    { media: '(prefers-color-scheme: dark)', color: '#262624' },
  ],
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies the saved or system theme before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}

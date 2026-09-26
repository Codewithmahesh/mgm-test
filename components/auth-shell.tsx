import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { COLLEGE_CITY, COLLEGE_NAME, Emblem, Logo, MadeBy, PORTAL_NAME } from '@/components/brand'

/** Split sign-in layout: navy college panel on the left, form on the right. Fills the screen at any size. */
export function AuthShell({ role, title, subtitle, children, footer, points }: {
  role: 'Faculty' | 'Student'
  title: string
  subtitle?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  points?: string[]
}) {
  const bullets = points ?? (role === 'Faculty'
    ? ['Create exam rooms with MCQ and coding problems', 'Generate questions from PDFs, notes or a topic with AI', 'Live proctoring, leaderboards and Excel export']
    : ['Sign in with your college email', 'Join exams with the room code from your faculty', 'Answers save automatically as you go'])
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-navy px-12 py-10 text-white lg:flex lg:flex-col xl:px-16">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:32px_32px]" />
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 size-[520px] rounded-full bg-brand/10 blur-3xl" />
        <p className="relative text-xs font-semibold uppercase tracking-[0.2em] text-white/50">{PORTAL_NAME}</p>
        <div className="relative my-auto max-w-lg py-10">
          <div className="flex items-center gap-5 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <Emblem size={88} className="drop-shadow-[0_8px_24px_rgba(245,158,11,0.35)]" />
            <div>
              <p className="text-2xl font-semibold leading-tight">{COLLEGE_NAME}</p>
              <p className="mt-1 text-sm text-white/55">{COLLEGE_CITY}</p>
            </div>
          </div>
          <p className="mt-12 font-mono text-xs uppercase tracking-[0.2em] text-brand">{role === 'Faculty' ? '// faculty workspace' : '// student portal'}</p>
          <h1 className="mt-4 text-[36px] font-medium leading-[1.15] tracking-tight xl:text-[40px]">{role === 'Faculty' ? 'Run fair, timed exams without the paperwork.' : 'Your exams, in one place.'}</h1>
          <ul className="mt-8 flex flex-col gap-3.5">
            {bullets.map(point => <li key={point} className="flex items-start gap-3 text-[15px] text-white/75"><CheckCircle2 className="mt-0.5 size-[18px] shrink-0 text-brand" />{point}</li>)}
          </ul>
        </div>
        <div className="relative flex items-center justify-between gap-4 text-xs text-white/40">
          <span>© {new Date().getFullYear()} {COLLEGE_NAME}, {COLLEGE_CITY}</span>
          <MadeBy dark />
        </div>
      </aside>
      <main className="flex min-h-dvh flex-col bg-background px-5 py-8 sm:px-10">
        <div className="flex items-center justify-between gap-4 lg:justify-end">
          <Logo className="lg:hidden" size={40} />
          <Link href={role === 'Faculty' ? '/student/login' : '/teacher/login'} className="shrink-0 text-[13px] font-medium text-muted-foreground hover:text-foreground">
            {role === 'Faculty' ? 'Student? Sign in' : 'Faculty? Sign in'} →
          </Link>
        </div>
        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-10 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <h2 className="font-serif text-[28px] font-medium tracking-tight">{title}</h2>
          {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-6 text-center text-[13px] text-muted-foreground">{footer}</div>}
        </div>
        <p className="text-center text-xs text-muted-foreground lg:hidden"><MadeBy /></p>
      </main>
    </div>
  )
}

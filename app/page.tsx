import Link from 'next/link'
import { ArrowRight, BarChart3, Clock3, Code2, FileSpreadsheet, KeyRound, ListChecks, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { COLLEGE_CITY, COLLEGE_NAME, Emblem, Logo, PORTAL_NAME, SiteFooter } from '@/components/brand'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const features = [
  { icon: Sparkles, title: 'AI question generation', text: 'Upload a PDF, paste notes or name a topic. Choose how many MCQs and coding problems you need, then review before publishing.' },
  { icon: FileSpreadsheet, title: 'CSV import', text: 'Bring an existing question bank in one upload. Answers as letters, numbers or option text all work.' },
  { icon: Code2, title: 'Coding problems', text: 'CodeChef-style statements with input/output formats, constraints and samples, and a full code editor for C, C++, Java, Python and JavaScript.' },
  { icon: KeyRound, title: 'Exam rooms', text: 'Every room gets a join code, a timer and its own question pool. Each student gets a different paper, dealt round-robin.' },
  { icon: ShieldCheck, title: 'Fair by default', text: 'The timer runs on the server, answers autosave, papers submit themselves at time-up, and tab switches are recorded.' },
  { icon: BarChart3, title: 'Leaderboards & export', text: 'Live progress while the exam runs, a ranked leaderboard afterwards, coding answers to grade, and an Excel export.' },
]

const steps = [
  { title: 'Create a room', text: 'Name it, set the duration, and choose how many MCQs and coding problems each student gets.' },
  { title: 'Add questions', text: 'Import a CSV, generate with AI from your material, write your own, or reuse your question bank.' },
  { title: 'Share the code', text: 'Open the room. Students sign in with their college email and join with the six-character code.' },
  { title: 'Review results', text: 'Watch progress live, grade coding answers, and export the ranked results.' },
]

export default function HomePage() {
  return (
    <div className="min-h-screen bg-card">
      <header className="absolute inset-x-0 top-0 z-10">
        <div className="mx-auto flex h-20 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-8">
          <Logo dark size={44} />
          <nav className="flex items-center gap-2">
            <Link href="/student/login" className="rounded-md px-3 py-2 text-sm font-medium text-white/80 hover:text-white">Student login</Link>
            <Link href="/teacher/login" className={cn(buttonVariants({ size: 'sm' }), 'bg-white text-navy hover:bg-white/90')}>Faculty login</Link>
          </nav>
        </div>
      </header>

      <section className="relative flex min-h-dvh items-center overflow-hidden bg-navy pb-16 pt-28 text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:40px_40px]" />
        <div aria-hidden className="pointer-events-none absolute -right-48 top-1/4 size-[640px] rounded-full bg-brand/10 blur-3xl" />
        <div className="relative mx-auto grid w-full max-w-[1440px] items-center gap-14 px-4 sm:px-8 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 font-mono text-xs text-white/70"><span className="size-1.5 rounded-full bg-brand" />{PORTAL_NAME}</p>
            <h1 className="mt-6 text-4xl font-medium leading-[1.1] tracking-tight animate-in fade-in slide-in-from-bottom-3 duration-700 sm:text-[52px] 2xl:text-[60px]">Online exams that feel like a real contest.</h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-white/65 2xl:text-xl">The online examination portal of {COLLEGE_NAME}, {COLLEGE_CITY}. Faculty build timed MCQ and coding tests from a CSV, a PDF or plain notes; students take them in a secure, proctored, CodeChef-style exam room.</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/teacher/signup" className={cn(buttonVariants({ size: 'xl' }), 'bg-primary text-primary-foreground hover:bg-primary-hover')}>Create a faculty account <ArrowRight /></Link>
              <Link href="/student/activate" className={cn(buttonVariants({ size: 'xl', variant: 'outline' }), 'border-white/20 bg-transparent text-white hover:bg-white/10')}>Activate student account</Link>
            </div>
          </div>
          <ExamPreview />
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-20 sm:px-6 sm:py-24">
        <div className="max-w-2xl">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-primary">Everything in one place</p>
          <h2 className="mt-3 font-serif text-4xl font-medium tracking-tight">From question paper to leaderboard.</h2>
        </div>
        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {features.map(feature => (
            <div key={feature.title} className="bg-card p-6">
              <feature.icon className="size-5 text-primary" />
              <h3 className="mt-4 text-[15px] font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{feature.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-background">
        <div className="mx-auto max-w-[1440px] px-4 py-20 sm:px-6">
          <h2 className="font-serif text-4xl font-medium tracking-tight">How it works</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-4">
            {steps.map((step, index) => (
              <li key={step.title} className="relative">
                <span className="font-mono text-sm font-semibold text-primary">0{index + 1}</span>
                <h3 className="mt-2 text-[15px] font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1440px] gap-6 px-4 py-20 sm:px-6 md:grid-cols-2">
        <div className="rounded-xl border border-border p-7">
          <Users className="size-5 text-primary" />
          <h3 className="mt-4 text-lg font-semibold">For faculty</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Create rooms, generate or import questions, add your students by college email and see results as they come in.</p>
          <div className="mt-6 flex gap-2">
            <Link href="/teacher/login" className={buttonVariants()}>Faculty login</Link>
            <Link href="/teacher/signup" className={buttonVariants({ variant: 'outline' })}>Sign up</Link>
          </div>
        </div>
        <div className="rounded-xl border border-border p-7">
          <ListChecks className="size-5 text-primary" />
          <h3 className="mt-4 text-lg font-semibold">For students</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">First time here? Activate your account with the OTP sent to your college email, set a password, and you&apos;re ready to join exams.</p>
          <div className="mt-6 flex gap-2">
            <Link href="/student/login" className={buttonVariants()}>Student login</Link>
            <Link href="/student/activate" className={buttonVariants({ variant: 'outline' })}>Activate account</Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-8">
          <div className="mb-6 flex items-center gap-3"><Emblem size={36} /><div className="leading-tight"><p className="text-sm font-semibold">{COLLEGE_NAME}</p><p className="text-xs text-muted-foreground">{COLLEGE_CITY} · {PORTAL_NAME}</p></div></div>
          <SiteFooter />
        </div>
      </footer>
    </div>
  )
}

function ExamPreview() {
  return (
    <div aria-hidden className="overflow-hidden rounded-xl border border-white/10 bg-navy-2 shadow-2xl shadow-black/40">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-white/60"><span className="font-semibold text-white">Data Structures · Mid-Sem</span><span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">Proctored</span></div>
        <span className="flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 font-mono text-xs text-brand"><Clock3 className="size-3.5" />00:42:17</span>
      </div>
      <div className="grid grid-cols-[1fr_1.1fr]">
        <div className="border-r border-white/10 p-4">
          <p className="text-[13px] font-semibold text-white">P2 · Pair Sum</p>
          <p className="mt-2 text-xs leading-5 text-white/55">Given an array of N integers and a target K, print the number of pairs (i, j) with i &lt; j and A[i] + A[j] = K.</p>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-white/40">Sample input</p>
          <pre className="mt-1 rounded bg-black/30 p-2 font-mono text-[11px] text-white/80">5 6{'\n'}1 5 3 3 2</pre>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-white/40">Sample output</p>
          <pre className="mt-1 rounded bg-black/30 p-2 font-mono text-[11px] text-white/80">2</pre>
        </div>
        <div className="p-4 font-mono text-[11.5px] leading-5">
          <div className="mb-2 flex gap-2"><span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">C++ 17</span></div>
          <p><span className="text-[#c792ea]">int</span> <span className="text-[#82aaff]">main</span><span className="text-white/70">() {'{'}</span></p>
          <p className="pl-4"><span className="text-[#c792ea]">int</span> <span className="text-white/80">n, k;</span> <span className="text-white/80">cin &gt;&gt; n &gt;&gt; k;</span></p>
          <p className="pl-4"><span className="text-white/80">map&lt;</span><span className="text-[#c792ea]">int</span><span className="text-white/80">,</span><span className="text-[#c792ea]">int</span><span className="text-white/80">&gt; seen;</span></p>
          <p className="pl-4"><span className="text-[#c792ea]">long long</span> <span className="text-white/80">ans = </span><span className="text-[#f78c6c]">0</span><span className="text-white/80">;</span></p>
          <p className="pl-4"><span className="text-[#89ddff]">for</span> <span className="text-white/80">(</span><span className="text-[#c792ea]">int</span> <span className="text-white/80">i = </span><span className="text-[#f78c6c]">0</span><span className="text-white/80">; i &lt; n; i++) {'{'}</span></p>
          <p className="pl-8 text-white/40">{'// ...'}</p>
          <p className="pl-4 text-white/80">{'}'}</p>
          <p className="text-white/70">{'}'}</p>
          <div className="mt-4 flex items-center gap-2 text-[10px] text-white/45"><span className="size-1.5 rounded-full bg-[#4ade80]" />Saved</div>
        </div>
      </div>
    </div>
  )
}

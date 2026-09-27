import { CompilerPanel } from '@/components/compiler-panel'

export const metadata = {
  title: 'Code Compiler — MGM Test',
  description: 'Multi-language online code compiler supporting Python, C++, Java, JavaScript, and C. Write, run, and test code instantly.',
}

export default function CompilerPage() {
  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
        <a href="/" className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-primary transition-colors">
          ← Back
        </a>
        <div className="h-5 w-px bg-border" />
        <h1 className="text-sm font-semibold">Code Compiler</h1>
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">Beta</span>
      </header>
      <main className="min-h-0 flex-1">
        <CompilerPanel />
      </main>
    </div>
  )
}

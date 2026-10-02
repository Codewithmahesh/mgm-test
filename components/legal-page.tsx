import { Logo, SiteFooter } from '@/components/brand'
import { cn } from '@/lib/utils'

/** Public information pages (privacy policy, account deletion): the college header, a readable column, the footer. */
export function LegalPage({ title, updated, intro, children }: { title: string; updated: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6"><Logo /></div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Last updated {updated}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {intro && <div className="mt-4 text-[15px] leading-7 text-muted-foreground">{intro}</div>}
        <div className="mt-10 flex flex-col gap-10">{children}</div>
      </main>
      <div className="border-t border-border">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6"><SiteFooter /></div>
      </div>
    </div>
  )
}

/** A numbered or plain section of a legal page. */
export function LegalSection({ id, title, children, className }: { id?: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={cn('scroll-mt-6', className)}>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-[15px] leading-7 text-foreground/85 [&_a]:font-medium [&_a]:text-primary [&_a:hover]:underline [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">{children}</div>
    </section>
  )
}

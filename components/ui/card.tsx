import * as React from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]', className)} {...props} />
}

export function CardHeader({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-border px-5 py-4', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />
}

type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'dark'

const tones: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground ring-border',
  blue: 'bg-primary-soft text-primary ring-primary-border',
  green: 'bg-success-soft text-success ring-success-border',
  amber: 'bg-warning-soft text-warning ring-warning-border',
  red: 'bg-danger-soft text-danger ring-danger-border',
  violet: 'bg-violet-soft text-violet ring-violet-border',
  dark: 'bg-navy text-white ring-navy',
}

export function Badge({ tone = 'neutral', dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'blue' }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ComponentType<{ className?: string }>; tone?: 'blue' | 'green' | 'amber' | 'violet' | 'red' }) {
  const iconTone = { blue: 'bg-primary-soft text-primary', green: 'bg-success-soft text-success', amber: 'bg-warning-soft text-warning', violet: 'bg-violet-soft text-violet', red: 'bg-danger-soft text-danger' }[tone]
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground tabular-nums">{value}</p>
        </div>
        {Icon && <span className={cn('flex size-9 items-center justify-center rounded-md', iconTone)}><Icon className="size-[18px]" /></span>}
      </div>
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  )
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon?: React.ComponentType<{ className?: string }>; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {Icon && <span className="mb-4 flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-5" /></span>}
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-5 text-muted-foreground">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={cn('inline-block size-5 animate-spin rounded-full border-2 border-border-strong border-t-primary', className)} />
}

export function PageLoader() {
  return <div className="flex min-h-[50vh] items-center justify-center"><Spinner className="size-6" /></div>
}

export function Progress({ value, className, tone = 'blue' }: { value: number; className?: string; tone?: 'blue' | 'green' | 'amber' }) {
  const color = { blue: 'bg-primary', green: 'bg-success', amber: 'bg-brand' }[tone]
  return <div className={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)}><div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
}

export function PageHeader({ title, description, eyebrow, actions, className }: { title: React.ReactNode; description?: React.ReactNode; eyebrow?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-[13px] text-muted-foreground">{eyebrow}</div>}
        <h1 className="text-[28px] font-medium leading-tight tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

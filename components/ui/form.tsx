import * as React from 'react'
import { cn } from '@/lib/utils'

const control =
  'w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-xs transition-colors placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 aria-invalid:border-danger'

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, 'h-9', className)} {...props} />
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-24 py-2 leading-6', className)} {...props} />
}

// Themed dropdown (replaces the native <select>, whose arrow and option list can't be styled).
export { Select } from './select'

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-[13px] font-medium text-foreground', className)} {...props} />
}

/** Label + control + hint/error, stacked. */
export function Field({ label, hint, error, required, className, children, htmlFor }: { label?: React.ReactNode; hint?: React.ReactNode; error?: string; required?: boolean; className?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && <Label htmlFor={htmlFor}>{label}{required && <span className="ml-0.5 text-danger">*</span>}</Label>}
      {children}
      {error ? <p className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function Checkbox({ className, label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-start gap-2.5 text-sm', className)}>
      <input type="checkbox" className="mt-0.5 size-4 cursor-pointer rounded border-input accent-[var(--primary)]" {...props} />
      {label && <span>{label}</span>}
    </label>
  )
}

export function Alert({ tone = 'danger', className, children }: { tone?: 'danger' | 'warning' | 'success' | 'info'; className?: string; children: React.ReactNode }) {
  const tones = {
    danger: 'border-danger-border bg-danger-soft text-danger-ink',
    warning: 'border-warning-border bg-warning-soft text-warning-ink',
    success: 'border-success-border bg-success-soft text-success-ink',
    info: 'border-primary-border bg-primary-soft text-primary-ink',
  }
  return <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-md border px-3 py-2.5 text-[13px] leading-5', tones[tone], className)}>{children}</div>
}

'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Modal dialog: Esc and backdrop click close it, focus moves inside, page scroll locks. */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md', dismissible = true }: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  /** `full`: nearly the whole screen, for editors with a lot on them. */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  dismissible?: boolean
}) {
  const panel = React.useRef<HTMLDivElement>(null)
  const closeRef = React.useRef(onClose)
  const dismissRef = React.useRef(dismissible)
  React.useEffect(() => { closeRef.current = onClose; dismissRef.current = dismissible })
  // Runs only when the dialog opens or closes, so typing inside doesn't steal focus back to the first field.
  React.useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && dismissRef.current) closeRef.current() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    const focusable = panel.current?.querySelector<HTMLElement>('[autofocus], input, textarea, select, button:not([data-close])')
    ;(focusable ?? panel.current)?.focus()
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; previous?.focus?.() }
  }, [open])
  if (!open || typeof document === 'undefined') return null
  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-6xl sm:max-h-[94vh]' }[size]
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget && dismissible) onClose() }}>
      <div ref={panel} role="dialog" aria-modal="true" tabIndex={-1} className={cn('flex max-h-[92vh] w-full flex-col rounded-t-xl bg-card shadow-2xl outline-none sm:rounded-xl', width)}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
          </div>
          {dismissible && <button data-close onClick={onClose} aria-label="Close" className="-mr-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>}
        </div>
        {children && <div className={cn('overflow-y-auto px-5 py-4', size === 'full' && 'sm:px-6 sm:py-5')}>{children}</div>}
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/** Underline tabs. */
export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { value: T; label: React.ReactNode; count?: number }[]; value: T; onChange: (value: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('flex gap-1 overflow-x-auto border-b border-border', className)}>
      {tabs.map(tab => (
        <button key={tab.value} role="tab" aria-selected={value === tab.value} onClick={() => onChange(tab.value)} className={cn('relative -mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors', value === tab.value ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
          {tab.label}
          {tab.count !== undefined && <span className={cn('rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums', value === tab.value ? 'bg-primary-soft text-primary' : 'bg-muted text-muted-foreground')}>{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** Small click-to-open menu (e.g. user menu, row actions). */
export function Menu({ trigger, children, align = 'right', side = 'bottom' }: { trigger: (props: { onClick: () => void; 'aria-expanded': boolean }) => React.ReactNode; children: (close: () => void) => React.ReactNode; align?: 'left' | 'right'; side?: 'top' | 'bottom' }) {
  const [open, setOpen] = React.useState(false)
  const root = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div ref={root} className="relative">
      {trigger({ onClick: () => setOpen(value => !value), 'aria-expanded': open })}
      {open && <div role="menu" className={cn('absolute z-40 min-w-52 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-lg animate-in fade-in zoom-in-95 duration-150', side === 'top' ? 'bottom-full mb-1.5 origin-bottom' : 'mt-1.5 origin-top', align === 'right' ? 'right-0' : 'left-0')}>{children(() => setOpen(false))}</div>}
    </div>
  )
}

export function MenuItem({ icon: Icon, danger, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ComponentType<{ className?: string }>; danger?: boolean }) {
  return <button role="menuitem" className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary-hover focus-visible:bg-secondary-hover focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40', danger ? 'text-danger' : 'text-foreground', className)} {...props}>{Icon && <Icon className="size-4 opacity-70" />}{props.children}</button>
}

/* ---------- Toasts & confirm prompts ---------- */

type Toast = { id: number; tone: 'success' | 'error' | 'info'; message: string }
type ConfirmOptions = { title: string; description?: React.ReactNode; confirmLabel?: string; cancelLabel?: string; tone?: 'default' | 'danger' }

const FeedbackContext = React.createContext<{ toast: (message: string, tone?: Toast['tone']) => void; confirm: (options: ConfirmOptions) => Promise<boolean> } | null>(null)

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])
  const [prompt, setPrompt] = React.useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null)

  const toast = React.useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random()
    setToasts(list => [...list.slice(-3), { id, tone, message }])
    window.setTimeout(() => setToasts(list => list.filter(item => item.id !== id)), tone === 'error' ? 6000 : 3500)
  }, [])
  const confirm = React.useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => setPrompt({ ...options, resolve })), [])
  const close = (value: boolean) => { prompt?.resolve(value); setPrompt(null) }
  const value = React.useMemo(() => ({ toast, confirm }), [toast, confirm])

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map(item => (
          <div key={item.id} className={cn('pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2', item.tone === 'error' ? 'border-danger-border bg-card text-danger-ink' : 'border-border bg-navy text-white')}>
            <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', item.tone === 'error' ? 'bg-danger' : item.tone === 'info' ? 'bg-[#93b4ff]' : 'bg-[#4ade80]')} />
            <span className="flex-1 leading-5">{item.message}</span>
            <button onClick={() => setToasts(list => list.filter(t => t.id !== item.id))} aria-label="Dismiss" className="opacity-60 hover:opacity-100"><X className="size-3.5" /></button>
          </div>
        ))}
      </div>
      <Dialog open={Boolean(prompt)} onClose={() => close(false)} title={prompt?.title} description={prompt?.description} size="sm"
        footer={<>
          <button onClick={() => close(false)} className="h-9 rounded-md border border-border-strong bg-card px-3.5 text-sm font-medium hover:bg-muted">{prompt?.cancelLabel ?? 'Cancel'}</button>
          <button autoFocus onClick={() => close(true)} className={cn('h-9 rounded-md px-3.5 text-sm font-medium text-white', prompt?.tone === 'danger' ? 'bg-danger hover:bg-danger-hover' : 'bg-primary hover:bg-primary-hover')}>{prompt?.confirmLabel ?? 'Confirm'}</button>
        </>}
      />
    </FeedbackContext.Provider>
  )
}

export function useFeedback() {
  const context = React.useContext(FeedbackContext)
  if (!context) throw new Error('useFeedback must be used inside FeedbackProvider')
  return context
}

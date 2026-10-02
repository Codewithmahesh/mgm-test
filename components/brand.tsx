import Link from 'next/link'
import { cn } from '@/lib/utils'

export const COLLEGE_NAME = "MGM's College of Engineering"
export const COLLEGE_CITY = 'Nanded'
export const PORTAL_NAME = 'Online Examination Portal'
export const COMPANY_NAME = 'Exponentor'
/** Where people write about their data and accounts (privacy policy, account deletion). Set NEXT_PUBLIC_SUPPORT_EMAIL. */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || ''

/** MGM emblem. */
export function Emblem({ size = 36, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/mgm-logo.png" alt={`${COLLEGE_NAME}, ${COLLEGE_CITY}`} width={size} height={size} draggable={false} className={cn('shrink-0 select-none', className)} style={{ width: size, height: size }} />
  )
}

/** MGM emblem + college name (+ a small subtitle). The portal's only brand mark. */
export function Logo({ href = '/', dark = false, className, subtitle = `${COLLEGE_CITY} · ${PORTAL_NAME}`, size = 36, compact = false }: { href?: string; dark?: boolean; className?: string; subtitle?: string; size?: number; compact?: boolean }) {
  return (
    <Link href={href} className={cn('flex min-w-0 items-center gap-3', className)}>
      <Emblem size={size} />
      {!compact && (
        <span className="min-w-0 leading-tight">
          <span className={cn('block truncate text-[15px] font-semibold tracking-tight', dark ? 'text-white' : 'text-foreground')}>{COLLEGE_NAME}</span>
          {subtitle && <span className={cn('mt-0.5 block truncate text-[11px] font-medium', dark ? 'text-white/55' : 'text-muted-foreground')}>{subtitle}</span>}
        </span>
      )}
    </Link>
  )
}

/** Company credit shown in footers. */
export function MadeBy({ dark = false, className }: { dark?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      Designed &amp; developed by
      <span className={cn('inline-flex items-center gap-1 font-semibold', dark ? 'text-white/85' : 'text-foreground')}>
        <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden><path d="M2 13 8 3l6 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 9h6" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" /></svg>
        {COMPANY_NAME}
      </span>
    </span>
  )
}

export function SiteFooter({ dark = false, className }: { dark?: boolean; className?: string }) {
  return (
    <footer className={cn('flex flex-col items-center justify-between gap-2 text-xs sm:flex-row', dark ? 'text-white/45' : 'text-muted-foreground', className)}>
      <span>© {new Date().getFullYear()} {COLLEGE_NAME}, {COLLEGE_CITY}</span>
      <span className="flex items-center gap-4">
        <Link href="/privacy-policy" className="hover:underline">Privacy policy</Link>
        <Link href="/delete-account" className="hover:underline">Delete account</Link>
      </span>
      <MadeBy dark={dark} />
    </footer>
  )
}

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronsUpDown, LogOut, Menu as MenuIcon, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Sun, UserRound, X } from 'lucide-react'
import { COLLEGE_CITY, COLLEGE_NAME, Emblem, PORTAL_NAME, SiteFooter } from '@/components/brand'
import { ThemeSwitch, useTheme } from '@/components/theme'
import { Menu, MenuItem } from '@/components/ui/overlay'
import { initials } from '@/lib/api'
import { cn } from '@/lib/utils'

export type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean }

const ITEM = 42 // nav row height + gap, used to slide the active highlight

/**
 * Workspace shell: full-height sidebar (collapsible to an icon rail on desktop, a slide-in
 * drawer on phones), a slim top bar, and the page with its footer. Colours follow the theme.
 */
export function AppShell({ role, nav, user, onLogout, profileHref, action, children }: {
  role: 'Faculty' | 'Student'
  nav: NavItem[]
  user: { name: string; email: string; detail?: string } | null
  onLogout: () => void
  profileHref?: string
  action?: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const { choice, setChoice } = useTheme()
  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const signOut = () => { setSigningOut(true); onLogout() }

  useEffect(() => { try { setCollapsed(localStorage.getItem('mgm-sidebar') === 'collapsed') } catch { /* storage blocked */ } }, [])
  useEffect(() => { setDrawer(false) }, [pathname])
  const toggle = () => setCollapsed(value => { try { localStorage.setItem('mgm-sidebar', value ? 'open' : 'collapsed') } catch { /* ignore */ } return !value })

  const isActive = (item: NavItem) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`))
  const activeIndex = nav.findIndex(isActive)
  const current = nav[activeIndex]
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const workspace = role === 'Faculty' ? 'Faculty workspace' : 'Student portal'
  const nextTheme = choice === 'system' ? 'light' : choice === 'light' ? 'dark' : 'system'
  const ThemeIcon = choice === 'system' ? Monitor : choice === 'light' ? Sun : Moon

  const userMenu = (narrow: boolean) => (
    <Menu align="left" side="top" trigger={props => (
      <button {...props} className={cn('flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-sidebar-hover', narrow && 'justify-center')} title={narrow ? user?.name : undefined}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initials(user?.name || user?.email || '')}</span>
        {!narrow && (
          <>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13px] font-medium text-foreground">{user?.name || 'Loading…'}</span>
              <span className="mt-0.5 block truncate text-[11px] text-sidebar-muted">{user?.detail || user?.email}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted" />
          </>
        )}
      </button>
    )}>
      {close => (
        <div className="w-60">
          <div className="border-b border-border px-3 py-2.5">
            <div className="truncate text-sm font-semibold">{user?.name || 'Account'}</div>
            <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
          </div>
          {profileHref && <Link href={profileHref} onClick={close} className="flex items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-secondary-hover"><UserRound className="size-4 opacity-70" />Profile</Link>}
          <MenuItem icon={LogOut} onClick={() => { close(); signOut() }}>Sign out</MenuItem>
        </div>
      )}
    </Menu>
  )

  const sidebar = (mobile: boolean) => {
    const narrow = collapsed && !mobile
    return (
      <div className="flex h-full flex-col">
        {/* College identity: emblem, name and workspace stacked so nothing is squeezed. */}
        <div className={cn('shrink-0 transition-[padding] duration-300', narrow ? 'px-[18px] pb-4 pt-5' : 'px-5 pb-5 pt-6')}>
          <div className="flex items-start justify-between gap-2">
            <Link href={nav[0]?.href ?? '/'} className="rounded-full focus-visible:ring-2 focus-visible:ring-ring" title={narrow ? `${COLLEGE_NAME}, ${COLLEGE_CITY}` : undefined}>
              <Emblem size={narrow ? 40 : 48} className="transition-all duration-300" />
            </Link>
            {mobile && <button onClick={() => setDrawer(false)} aria-label="Close menu" className="rounded-md p-1.5 text-sidebar-muted hover:bg-sidebar-hover hover:text-foreground"><X className="size-5" /></button>}
          </div>
          <div className={cn('grid transition-[grid-template-rows,opacity] duration-300', narrow ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100')}>
            <div className="overflow-hidden">
              <p className="mt-3.5 font-serif text-[17px] font-medium leading-snug tracking-tight text-foreground">{COLLEGE_NAME}</p>
              <p className="mt-0.5 text-xs text-sidebar-muted">{COLLEGE_CITY} · {PORTAL_NAME}</p>
              <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-sidebar-border bg-card/60 px-2.5 py-1 text-[11px] font-medium text-sidebar-foreground">
                <span className="size-1.5 rounded-full bg-success" />{workspace}
              </span>
            </div>
          </div>
        </div>

        {action && (
          <div className={cn('px-4 transition-[padding] duration-300', narrow && 'px-[14px]')}>
            <Link href={action.href} title={narrow ? action.label : undefined} className={cn('group flex h-10 items-center justify-center gap-2 overflow-hidden rounded-xl bg-primary text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary-hover active:scale-[0.98]', narrow ? 'w-12' : 'w-full')}>
              <action.icon className="size-[18px] shrink-0 transition-transform duration-300 group-hover:rotate-90" />
              {!narrow && <span className="whitespace-nowrap">{action.label}</span>}
            </Link>
          </div>
        )}

        <nav className="relative mt-6 flex-1 overflow-y-auto overflow-x-hidden px-3" aria-label="Main">
          {!narrow && <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-[0.12em] text-sidebar-muted">Menu</p>}
          <div className="relative flex flex-col gap-0.5">
            {activeIndex >= 0 && (
              <span aria-hidden className="absolute inset-x-0 h-10 rounded-xl bg-sidebar-active transition-[top] duration-300 ease-out" style={{ top: activeIndex * ITEM }}>
                <span className="absolute left-0 top-2.5 h-5 w-[3px] rounded-r-full bg-primary" />
              </span>
            )}
            {nav.map(item => {
              const active = isActive(item)
              return (
                <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={cn('group relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors', narrow && 'justify-center px-0', active ? 'font-medium text-foreground' : 'text-sidebar-foreground hover:bg-sidebar-hover hover:text-foreground')} style={{ marginBottom: 2 }}>
                  <item.icon className={cn('size-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110', active ? 'text-primary' : 'text-sidebar-muted group-hover:text-foreground')} />
                  {!narrow && <span className="whitespace-nowrap">{item.label}</span>}
                  {narrow && <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-md bg-navy px-2.5 py-1.5 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">{item.label}</span>}
                </Link>
              )
            })}
          </div>
        </nav>

        <div className="flex flex-col gap-2 border-t border-sidebar-border p-3">
          {narrow ? (
            <button onClick={() => setChoice(nextTheme)} title={`Theme: ${choice}. Switch to ${nextTheme}`} aria-label={`Theme: ${choice}`} className="mx-auto flex size-9 items-center justify-center rounded-lg text-sidebar-muted hover:bg-sidebar-hover hover:text-foreground"><ThemeIcon className="size-4" /></button>
          ) : <ThemeSwitch />}
          {userMenu(narrow)}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {signingOut && (
        <div role="status" className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm">
          <span className="size-6 animate-spin rounded-full border-2 border-border-strong border-t-primary" />
          <p className="text-sm font-medium">Signing out…</p>
        </div>
      )}
      <aside className={cn('relative hidden shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-out lg:block', collapsed ? 'w-[76px]' : 'w-[280px]')}>
        {sidebar(false)}
      </aside>

      <div className={cn('fixed inset-0 z-50 lg:hidden', drawer ? 'pointer-events-auto' : 'pointer-events-none')} aria-hidden={!drawer}>
        <div onClick={() => setDrawer(false)} className={cn('absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300', drawer ? 'opacity-100' : 'opacity-0')} />
        <aside className={cn('absolute inset-y-0 left-0 w-[290px] max-w-[86vw] border-r border-sidebar-border bg-sidebar shadow-2xl transition-transform duration-300 ease-out', drawer ? 'translate-x-0' : '-translate-x-full')}>{sidebar(true)}</aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto" id="app-scroll">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <button onClick={() => setDrawer(true)} className="-ml-1 rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden" aria-label="Open menu"><MenuIcon className="size-5" /></button>
          <button onClick={toggle} className="-ml-2 hidden rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:inline-flex" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </button>
          <Emblem size={30} className="lg:hidden" />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{current?.label ?? PORTAL_NAME}</p>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">{today}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground md:flex">
              <span className="size-1.5 rounded-full bg-success" />{role}
            </span>
            <Menu trigger={props => (
              <button {...props} className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-muted">
                <span className="flex size-8 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{initials(user?.name || user?.email || '')}</span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </button>
            )}>
              {close => (
                <>
                  <div className="border-b border-border px-3 py-2.5">
                    <div className="truncate text-sm font-semibold">{user?.name || 'Account'}</div>
                    <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
                    {user?.detail && <div className="mt-0.5 truncate text-xs text-muted-foreground">{user.detail}</div>}
                  </div>
                  {profileHref && <Link href={profileHref} onClick={close} className="flex items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-secondary-hover"><UserRound className="size-4 opacity-70" />Profile</Link>}
                  <MenuItem icon={LogOut} onClick={() => { close(); signOut() }}>Sign out</MenuItem>
                </>
              )}
            </Menu>
          </div>
        </header>

        <main key={pathname} className="mx-auto w-full max-w-[1920px] flex-1 px-4 py-6 animate-in fade-in slide-in-from-bottom-1 duration-300 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
        <div className="mx-auto w-full max-w-[1920px] px-4 sm:px-6 lg:px-8">
          <SiteFooter className="border-t border-border py-5" />
        </div>
      </div>
    </div>
  )
}

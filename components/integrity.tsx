'use client'

import { Copy, Eye, Keyboard, Maximize, MonitorSmartphone, MousePointerClick, Printer, ShieldAlert, ShieldCheck, Wifi, ClipboardPaste, AppWindow } from 'lucide-react'
import { Badge } from '@/components/ui/card'
import { INTEGRITY_EVENTS, INTEGRITY_EVENT_TYPES, RISK_META, riskOf, type Flags, type IntegrityEvent, type RiskLevel } from '@/lib/integrity'
import { cn } from '@/lib/utils'

export const EVENT_ICONS: Record<IntegrityEvent, React.ComponentType<{ className?: string }>> = {
  tab_switch: AppWindow,
  focus_lost: Eye,
  fullscreen_exit: Maximize,
  paste: ClipboardPaste,
  copy: Copy,
  context_menu: MousePointerClick,
  devtools: Keyboard,
  print: Printer,
  multiple_sessions: MonitorSmartphone,
  ip_change: Wifi,
}

export function RiskBadge({ level, score }: { level: RiskLevel; score?: number }) {
  const meta = RISK_META[level]
  const Icon = level === 'clean' ? ShieldCheck : ShieldAlert
  return (
    <Badge tone={meta.tone} className="gap-1">
      <Icon className="size-3" />
      {meta.label}{score !== undefined && level !== 'clean' ? ` · ${score}` : ''}
    </Badge>
  )
}

/** One small chip per recorded signal, e.g. "Tab 3", with the full label on hover. */
export function FlagChips({ flags, limit, className }: { flags: Flags; limit?: number; className?: string }) {
  const entries = INTEGRITY_EVENT_TYPES.filter(type => (flags[type] ?? 0) > 0).sort((a, b) => INTEGRITY_EVENTS[b].weight * (flags[b] ?? 0) - INTEGRITY_EVENTS[a].weight * (flags[a] ?? 0))
  if (!entries.length) return <span className="text-xs text-muted-foreground">—</span>
  const shown = limit ? entries.slice(0, limit) : entries
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {shown.map(type => {
        const Icon = EVENT_ICONS[type]
        const serious = INTEGRITY_EVENTS[type].violation
        return (
          <span key={type} title={`${INTEGRITY_EVENTS[type].label}: ${flags[type]}`} className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums', serious ? 'bg-danger-soft text-danger' : 'bg-muted text-muted-foreground')}>
            <Icon className="size-3" />{INTEGRITY_EVENTS[type].short} {flags[type]}
          </span>
        )
      })}
      {limit && entries.length > limit && <span className="text-[11px] text-muted-foreground">+{entries.length - limit}</span>}
    </span>
  )
}

export function IntegrityCell({ flags }: { flags: Flags }) {
  const risk = riskOf(flags)
  return (
    <div className="flex flex-col items-start gap-1">
      <RiskBadge level={risk.level} />
      {risk.level !== 'clean' && <FlagChips flags={flags} limit={3} />}
    </div>
  )
}

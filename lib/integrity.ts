// Proctoring signals recorded during an exam, shared by the server and the UI.

export const INTEGRITY_EVENTS = {
  tab_switch: { label: 'Tab switched', short: 'Tab', weight: 2, violation: true, help: 'Left the exam tab or minimised the browser.' },
  focus_lost: { label: 'Window focus lost', short: 'Focus', weight: 1, violation: true, help: 'Clicked into another app or window while the exam was visible.' },
  fullscreen_exit: { label: 'Left fullscreen', short: 'Fullscreen', weight: 2, violation: true, help: 'Exited fullscreen mode.' },
  paste: { label: 'Paste blocked', short: 'Paste', weight: 2, violation: true, help: 'Tried to paste text from outside the exam.' },
  copy: { label: 'Copy blocked', short: 'Copy', weight: 1, violation: false, help: 'Tried to copy question text.' },
  context_menu: { label: 'Right-click blocked', short: 'Right-click', weight: 0.5, violation: false, help: 'Opened the right-click menu.' },
  devtools: { label: 'Developer tools shortcut', short: 'DevTools', weight: 2, violation: true, help: 'Pressed a developer-tools, view-source or save shortcut.' },
  print: { label: 'Print / screenshot shortcut', short: 'Print', weight: 1, violation: false, help: 'Tried to print the page or pressed a screenshot key.' },
  multiple_sessions: { label: 'Opened on another device/tab', short: 'Multi-session', weight: 3, violation: true, help: 'The same exam was opened in a second tab, window or device.' },
  ip_change: { label: 'Network changed', short: 'IP change', weight: 1, violation: false, help: 'Continued the exam from a different IP address.' },
} as const

export type IntegrityEvent = keyof typeof INTEGRITY_EVENTS
export const INTEGRITY_EVENT_TYPES = Object.keys(INTEGRITY_EVENTS) as IntegrityEvent[]
export type Flags = Partial<Record<IntegrityEvent, number>>

export function isIntegrityEvent(value: unknown): value is IntegrityEvent {
  return typeof value === 'string' && value in INTEGRITY_EVENTS
}

/** Counted against the room's "auto-submit after N violations" limit. */
export function violationCount(flags: Flags | null | undefined) {
  return INTEGRITY_EVENT_TYPES.reduce((sum, type) => sum + (INTEGRITY_EVENTS[type].violation ? flags?.[type] ?? 0 : 0), 0)
}

export type RiskLevel = 'clean' | 'low' | 'medium' | 'high'

/** Weighted score of all signals → a simple level the faculty can scan. */
export function riskOf(flags: Flags | null | undefined): { score: number; level: RiskLevel } {
  const score = INTEGRITY_EVENT_TYPES.reduce((sum, type) => sum + INTEGRITY_EVENTS[type].weight * (flags?.[type] ?? 0), 0)
  const level: RiskLevel = score === 0 ? 'clean' : score < 3 ? 'low' : score < 8 ? 'medium' : 'high'
  return { score: Math.round(score * 10) / 10, level }
}

export const RISK_META: Record<RiskLevel, { label: string; tone: 'neutral' | 'green' | 'amber' | 'red' }> = {
  clean: { label: 'No flags', tone: 'green' },
  low: { label: 'Low risk', tone: 'neutral' },
  medium: { label: 'Suspicious', tone: 'amber' },
  high: { label: 'High risk', tone: 'red' },
}

/** Old attempts only stored tabSwitches; fold it into the flags. */
export function normalizeFlags(flags: unknown, tabSwitches?: number | null): Flags {
  const result: Flags = {}
  const source = flags instanceof Map ? Object.fromEntries(flags) : (flags as Record<string, unknown> | null) ?? {}
  for (const type of INTEGRITY_EVENT_TYPES) {
    const value = Number(source[type] ?? 0)
    if (value > 0) result[type] = value
  }
  if (!result.tab_switch && tabSwitches) result.tab_switch = tabSwitches
  return result
}

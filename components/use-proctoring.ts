'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { INTEGRITY_EVENTS, type IntegrityEvent } from '@/lib/integrity'

export type ProctoringConfig = { requireFullscreen: boolean; blockCopyPaste: boolean; maxViolations: number }
export type Violation = { type: IntegrityEvent; violations: number; maxViolations: number; at: number }

const THROTTLE_MS = 1500

// Text copied by the exam itself (the student's own code, or a sample input via its Copy button)
// may be pasted back into the editor.
let allowedClipboard = ''
export function allowClipboardText(text: string) { allowedClipboard = text }

type KeyboardLock = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void }
const keyboardApi = () => (typeof navigator !== 'undefined' ? (navigator as unknown as { keyboard?: KeyboardLock }).keyboard : undefined)

/**
 * Keyboard Lock (Chrome/Edge, in fullscreen, on https or localhost): Escape, Alt+Tab, the Windows
 * key and similar go to the page instead of the browser/OS. A normal Escape press then does
 * nothing; the student has to press and hold Escape to leave fullscreen, which is recorded.
 */
export function lockExamKeys() { keyboardApi()?.lock?.().catch(() => {}) }
export const keyboardLockSupported = () => typeof keyboardApi()?.lock === 'function'

type MonacoGlobal = { editor?: { getModels: () => { getValue: () => string }[] } }
/** True when the pasted text already exists in the student's code (e.g. moving their own lines). */
function inOwnCode(text: string) {
  const monaco = (window as unknown as { monaco?: MonacoGlobal }).monaco
  const normalize = (value: string) => value.replace(/\r\n/g, '\n')
  const needle = normalize(text)
  if (monaco?.editor?.getModels().some(model => normalize(model.getValue()).includes(needle))) return true
  return [...document.querySelectorAll<HTMLTextAreaElement>('textarea[data-code-editor]')].some(el => normalize(el.value).includes(needle))
}
// Shortcuts for developer tools, view-source, save and print. Browsers still allow opening
// these from menus, so this deters rather than prevents; every attempt is recorded.
function blockedShortcut(event: KeyboardEvent): IntegrityEvent | null {
  const key = event.key.toLowerCase()
  const mod = event.ctrlKey || event.metaKey
  if (key === 'f12') return 'devtools'
  if (mod && event.shiftKey && ['i', 'j', 'c', 'k'].includes(key)) return 'devtools'
  if (mod && event.altKey && ['i', 'j', 'c', 'u'].includes(key)) return 'devtools'
  if (mod && ['u', 's'].includes(key)) return 'devtools'
  if (mod && key === 'p') return 'print'
  if (key === 'printscreen') return 'print'
  return null
}

/**
 * Client-side exam proctoring: reports tab switches, focus loss, fullscreen exits, blocked
 * copy/paste/right-click and blocked shortcuts to the server, and enforces fullscreen.
 */
export function useProctoring({ enabled, config, report }: {
  enabled: boolean
  config: ProctoringConfig | null
  report: (type: IntegrityEvent, detail?: string) => Promise<{ violations: number; maxViolations: number } | null>
}) {
  const [violation, setViolation] = useState<Violation | null>(null)
  const [fullscreenNeeded, setFullscreenNeeded] = useState(false)
  const [escapeNotice, setEscapeNotice] = useState(0)
  const last = useRef<Partial<Record<IntegrityEvent, number>>>({})
  const reportRef = useRef(report)
  useEffect(() => { reportRef.current = report })

  const fullscreenSupported = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled)
  const mustFullscreen = Boolean(enabled && config?.requireFullscreen && fullscreenSupported)

  const flag = useCallback(async (type: IntegrityEvent, detail = '', warn = true) => {
    const now = Date.now()
    if (now - (last.current[type] ?? 0) < THROTTLE_MS) return
    last.current[type] = now
    const result = await reportRef.current(type, detail).catch(() => null)
    if (warn && result && INTEGRITY_EVENTS[type].weight >= 1) setViolation({ type, violations: result.violations, maxViolations: result.maxViolations, at: now })
  }, [])

  const enterFullscreen = useCallback(async () => {
    try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }) } catch { /* user dismissed or unsupported */ }
    if (document.fullscreenElement) lockExamKeys()
    setFullscreenNeeded(mustFullscreen && !document.fullscreenElement)
  }, [mustFullscreen])

  useEffect(() => {
    if (!enabled || !config) return
    setFullscreenNeeded(mustFullscreen && !document.fullscreenElement)
    if (mustFullscreen && document.fullscreenElement) lockExamKeys()
    let blurTimer: number | undefined

    const onVisibility = () => { if (document.visibilityState === 'hidden') flag('tab_switch', 'Tab hidden') }
    // Switching tabs fires blur first, then visibilitychange; wait briefly so it isn't counted twice.
    const onBlur = () => {
      window.clearTimeout(blurTimer)
      blurTimer = window.setTimeout(() => { if (document.visibilityState === 'visible' && !document.hasFocus()) flag('focus_lost', 'Another window or app took focus') }, 400)
    }
    const onFullscreen = () => {
      if (!mustFullscreen) return
      const inside = Boolean(document.fullscreenElement)
      if (inside) lockExamKeys()
      setFullscreenNeeded(!inside)
      if (!inside) flag('fullscreen_exit', 'Exited fullscreen')
    }
    const inEditor = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('.monaco-editor, [data-code-editor]'))
    const onCopy = (event: ClipboardEvent) => {
      if (!config.blockCopyPaste) return
      // Copying inside the editor is fine (pasting it back is checked against the code); copying question text is not.
      if (inEditor(event.target)) return
      event.preventDefault()
      flag('copy', event.type === 'cut' ? 'Cut blocked' : 'Copy blocked')
    }
    const onPaste = (event: ClipboardEvent) => {
      if (!config.blockCopyPaste) return
      const text = event.clipboardData?.getData('text') ?? ''
      if (inEditor(event.target) && text && (text.trim() === allowedClipboard.trim() || inOwnCode(text))) return
      event.preventDefault()
      event.stopImmediatePropagation()
      flag('paste', `Blocked paste of ${text.length} characters`)
    }
    const onContextMenu = (event: MouseEvent) => {
      if (!config.blockCopyPaste) return
      event.preventDefault()
      flag('context_menu', '', false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && mustFullscreen && document.fullscreenElement) {
        // With Keyboard Lock active this press doesn't leave fullscreen; tell the student why.
        event.preventDefault()
        setEscapeNotice(Date.now())
        return
      }
      const type = blockedShortcut(event)
      if (!type) return
      event.preventDefault()
      event.stopPropagation()
      flag(type, `${event.ctrlKey || event.metaKey ? 'Ctrl+' : ''}${event.shiftKey ? 'Shift+' : ''}${event.key}`)
    }
    const onDragStart = (event: DragEvent) => { if (config.blockCopyPaste && !inEditor(event.target)) event.preventDefault() }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    document.addEventListener('fullscreenchange', onFullscreen)
    window.addEventListener('copy', onCopy, true)
    window.addEventListener('cut', onCopy, true)
    window.addEventListener('paste', onPaste, true)
    window.addEventListener('contextmenu', onContextMenu, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('dragstart', onDragStart, true)
    return () => {
      window.clearTimeout(blurTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('fullscreenchange', onFullscreen)
      window.removeEventListener('copy', onCopy, true)
      window.removeEventListener('cut', onCopy, true)
      window.removeEventListener('paste', onPaste, true)
      window.removeEventListener('contextmenu', onContextMenu, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('dragstart', onDragStart, true)
    }
  }, [enabled, config, mustFullscreen, flag])

  useEffect(() => {
    if (!escapeNotice) return
    const timer = window.setTimeout(() => setEscapeNotice(0), 4000)
    return () => window.clearTimeout(timer)
  }, [escapeNotice])

  return { violation, dismissViolation: () => setViolation(null), fullscreenNeeded: mustFullscreen && fullscreenNeeded, enterFullscreen, escapeNotice: Boolean(escapeNotice) }
}

/** Leave fullscreen once the exam is over. */
export function exitExamFullscreen() {
  keyboardApi()?.unlock?.()
  if (typeof document !== 'undefined' && document.fullscreenElement) document.exitFullscreen().catch(() => {})
}

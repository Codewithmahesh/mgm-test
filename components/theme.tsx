'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { THEME_STORAGE_KEY as STORAGE_KEY } from '@/lib/theme-script'
import { cn } from '@/lib/utils'

export type ThemeChoice = 'system' | 'light' | 'dark'
const ThemeContext = createContext<{ choice: ThemeChoice; resolved: 'light' | 'dark'; setChoice: (choice: ThemeChoice) => void }>({ choice: 'system', resolved: 'light', setChoice: () => {} })
export const useTheme = () => useContext(ThemeContext)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>('system')
  const [resolved, setResolved] = useState<'light' | 'dark'>('light')

  const apply = useCallback((next: ThemeChoice) => {
    const dark = next === 'dark' || (next === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    setResolved(dark ? 'dark' : 'light')
  }, [])

  useEffect(() => {
    let saved: ThemeChoice = 'system'
    try { const value = localStorage.getItem(STORAGE_KEY); if (value === 'light' || value === 'dark') saved = value } catch { /* storage blocked */ }
    setChoiceState(saved)
    apply(saved)
  }, [apply])

  // Follow the OS when set to "system".
  useEffect(() => {
    if (choice !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [choice, apply])

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next)
    try { if (next === 'system') localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
    apply(next)
  }, [apply])

  return <ThemeContext.Provider value={{ choice, resolved, setChoice }}>{children}</ThemeContext.Provider>
}

/** System / Light / Dark segmented switch. */
export function ThemeSwitch({ className }: { className?: string }) {
  const { choice, setChoice } = useTheme()
  const options: { value: ThemeChoice; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { value: 'system', label: 'System', icon: Monitor },
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
  ]
  return (
    <div role="radiogroup" aria-label="Theme" className={cn('relative grid grid-cols-3 rounded-lg bg-sidebar-hover p-0.5', className)}>
      <span aria-hidden className="absolute inset-y-0.5 left-0.5 w-[calc((100%-4px)/3)] rounded-md bg-card shadow-sm transition-transform duration-300 ease-out" style={{ transform: `translateX(${options.findIndex(o => o.value === choice) * 100}%)` }} />
      {options.map(option => (
        <button key={option.value} role="radio" aria-checked={choice === option.value} title={option.label} onClick={() => setChoice(option.value)}
          className={cn('relative z-10 flex h-7 items-center justify-center gap-1.5 rounded-md text-[11px] font-medium transition-colors', choice === option.value ? 'text-foreground' : 'text-sidebar-muted hover:text-sidebar-foreground')}>
          <option.icon className="size-3.5" />
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  )
}

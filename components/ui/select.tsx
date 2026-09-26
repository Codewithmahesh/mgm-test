'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

type Option = { value: string; label: React.ReactNode; text: string; disabled: boolean }

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

/** Reads <option> children (including ones inside arrays/fragments) into plain options. */
function readOptions(children: React.ReactNode): Option[] {
  const out: Option[] = []
  React.Children.forEach(children, child => {
    if (!React.isValidElement<{ value?: string | number; children?: React.ReactNode; disabled?: boolean }>(child)) return
    if (child.type === React.Fragment) { out.push(...readOptions(child.props.children)); return }
    if (child.type !== 'option') return
    const value = child.props.value === undefined ? textOf(child.props.children) : String(child.props.value)
    out.push({ value, label: child.props.children, text: textOf(child.props.children), disabled: Boolean(child.props.disabled) })
  })
  return out
}

type SelectProps = {
  value?: string
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void
  children: React.ReactNode
  className?: string
  id?: string
  name?: string
  required?: boolean
  disabled?: boolean
  placeholder?: string
  'aria-label'?: string
}

/**
 * Themed dropdown with a visible chevron, keyboard support (↑ ↓ Home End Enter Esc and
 * type-to-find) and a popover that flips upward near the bottom of the screen.
 * Drop-in for <select>: takes <option> children and calls onChange with { target: { value } }.
 */
export function Select({ value = '', onChange, children, className, id, name, required, disabled, placeholder, 'aria-label': ariaLabel }: SelectProps) {
  const options = React.useMemo(() => readOptions(children), [children])
  const selectable = options.filter(o => !o.disabled)
  const selected = options.find(o => o.value === value)
  const placeholderText = placeholder ?? options.find(o => o.disabled && o.value === '')?.text ?? 'Select…'

  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(-1)
  const [pos, setPos] = React.useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const list = React.useRef<HTMLUListElement>(null)
  const typed = React.useRef({ text: '', at: 0 })
  const listId = React.useId()

  const place = React.useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    const below = window.innerHeight - rect.bottom - 8
    const above = rect.top - 8
    const wanted = Math.min(300, selectable.length * 36 + 8)
    const up = below < wanted && above > below
    setPos({
      left: Math.min(rect.left, window.innerWidth - Math.max(rect.width, 180) - 8),
      width: Math.max(rect.width, 180),
      ...(up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      maxHeight: Math.max(120, Math.min(300, up ? above : below)),
    })
  }, [selectable.length])

  const openList = () => {
    if (disabled) return
    place()
    setActive(Math.max(0, selectable.findIndex(o => o.value === value)))
    setOpen(true)
  }
  const close = (focusTrigger = true) => { setOpen(false); if (focusTrigger) trigger.current?.focus() }
  const choose = (option: Option | undefined) => {
    if (!option || option.disabled) return
    if (option.value !== value) onChange?.({ target: { value: option.value, name: name ?? '', id: id ?? '' }, currentTarget: { value: option.value } } as unknown as React.ChangeEvent<HTMLSelectElement>)
    close()
  }

  // Keep the popover attached while the page or a dialog scrolls; close on outside click.
  React.useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!trigger.current?.contains(target) && !list.current?.contains(target)) close(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, place])

  React.useEffect(() => {
    if (open && active >= 0) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  function onKeyDown(event: React.KeyboardEvent) {
    if (disabled) return
    const key = event.key
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(key)) { event.preventDefault(); openList() }
      return
    }
    if (key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    else if (key === 'Tab') close(false)
    else if (key === 'ArrowDown') { event.preventDefault(); setActive(i => Math.min(selectable.length - 1, i + 1)) }
    else if (key === 'ArrowUp') { event.preventDefault(); setActive(i => Math.max(0, i - 1)) }
    else if (key === 'Home') { event.preventDefault(); setActive(0) }
    else if (key === 'End') { event.preventDefault(); setActive(selectable.length - 1) }
    else if (key === 'Enter' || key === ' ') { event.preventDefault(); choose(selectable[active]) }
    else if (key.length === 1 && /\S/.test(key)) {
      const now = Date.now()
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + key.toLowerCase(), at: now }
      const match = selectable.findIndex(o => o.text.toLowerCase().startsWith(typed.current.text))
      if (match >= 0) setActive(match)
    }
  }

  return (
    <div className="relative min-w-0">
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={cn(
          'group flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-sm text-foreground shadow-xs transition-colors hover:border-border-strong focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60',
          open && 'border-primary ring-3 ring-primary/15',
          className,
        )}
      >
        <span className={cn('min-w-0 truncate', !selected || selected.disabled ? 'text-subtle' : '')}>{selected && !selected.disabled ? selected.label : placeholderText}</span>
        <ChevronDown className={cn('size-4 shrink-0 opacity-60 transition-transform duration-200 group-hover:opacity-100', open && 'rotate-180 opacity-100')} />
      </button>
      {/* Keeps native "required" validation working. */}
      {required && <input tabIndex={-1} aria-hidden required value={selected && !selected.disabled ? value : ''} onChange={() => {}} name={name} className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-0" onInvalid={() => trigger.current?.focus()} />}

      {open && pos && typeof document !== 'undefined' && createPortal(
        <ul
          ref={list}
          id={listId}
          role="listbox"
          tabIndex={-1}
          onKeyDown={onKeyDown}
          style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }}
          className={cn('z-[80] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-xl animate-in fade-in zoom-in-95 duration-100', pos.bottom !== undefined ? 'origin-bottom' : 'origin-top')}
        >
          {selectable.length === 0 && <li className="px-3 py-2 text-muted-foreground">No options</li>}
          {selectable.map((option, index) => {
            const isSelected = option.value === value
            return (
              <li
                key={option.value}
                role="option"
                aria-selected={isSelected}
                data-index={index}
                onMouseEnter={() => setActive(index)}
                onMouseDown={event => event.preventDefault()}
                onClick={() => choose(option)}
                className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2 transition-colors', index === active ? 'bg-secondary-hover' : '', isSelected && 'font-medium text-primary-ink')}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                {isSelected && <Check className="size-4 shrink-0 text-primary" />}
              </li>
            )
          })}
        </ul>,
        document.body,
      )}
    </div>
  )
}

'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

// A thin progress bar at the top of the window while a page is loading: it starts when an internal link
// is clicked (or the browser goes back/forward) and completes when the new route has rendered.

/** Whether a click on this link will make the app router navigate to another page. */
function isNavigation(event: MouseEvent, anchor: HTMLAnchorElement) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
  if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return false
  const url = new URL(anchor.href, location.href)
  if (url.origin !== location.origin) return false
  // Same page (or only the #hash changes): nothing loads.
  return url.pathname !== location.pathname || url.search !== location.search
}

function Bar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [progress, setProgress] = useState<number | null>(null)
  const [fading, setFading] = useState(false)
  const timers = useRef<number[]>([])
  const active = useRef(false)
  // The route on screen, to tell a back/forward between pages from one that only changes the #hash.
  const route = useRef('')

  const clear = () => { timers.current.forEach(t => window.clearTimeout(t)); timers.current = [] }
  const after = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)) }

  const done = useRef(() => {})
  done.current = () => {
    if (!active.current) return
    active.current = false
    clear()
    setProgress(100)
    after(200, () => setFading(true))
    after(450, () => { setProgress(null); setFading(false) })
  }

  useEffect(() => {
    const start = () => {
      clear()
      active.current = true
      setFading(false)
      setProgress(8)
      // Creep towards 90% while waiting; slower the further it gets.
      const trickle = () => {
        setProgress(p => (p === null ? p : Math.min(90, p + (90 - p) * 0.12)))
        after(250, trickle)
      }
      after(120, trickle)
      // Never leave the bar hanging (e.g. a navigation that was cancelled).
      after(10_000, () => done.current())
    }
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (anchor && isNavigation(event, anchor)) start()
    }
    // Capture phase: Next's <Link> calls preventDefault() itself, so the click has to be seen before it does.
    document.addEventListener('click', onClick, true)
    const onPopState = () => { if (location.pathname + location.search !== route.current) start() }
    window.addEventListener('popstate', onPopState)
    return () => { document.removeEventListener('click', onClick, true); window.removeEventListener('popstate', onPopState); clear() }
  }, [])

  // The route changed: the new page is on screen.
  useEffect(() => {
    const query = searchParams.toString()
    route.current = pathname + (query ? `?${query}` : '')
    done.current()
  }, [pathname, searchParams])

  if (progress === null) return null
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]" style={{ opacity: fading ? 0 : 1, transition: 'opacity 250ms ease' }}>
      {/* Scaled rather than resized, so it animates on the compositor without re-laying out the page. */}
      <div className="h-full w-full origin-left bg-primary shadow-[0_0_8px_var(--primary)]" style={{ transform: `scaleX(${progress / 100})`, transition: 'transform 200ms ease-out' }} />
    </div>
  )
}

export function TopLoader() {
  // useSearchParams needs a Suspense boundary so static pages can still prerender.
  return <Suspense fallback={null}><Bar /></Suspense>
}

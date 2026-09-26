'use client'

import { useCallback, useRef } from 'react'

/**
 * Guards against out-of-order responses: when a list is reloaded several times in a row
 * (e.g. after quick deletes), only the most recently started request may update state.
 */
export function useLatestRequest() {
  const counter = useRef(0)
  return useCallback(<T,>(promise: Promise<T>, apply: (value: T) => void) => {
    const id = ++counter.current
    return promise.then(value => { if (id === counter.current) apply(value) })
  }, [])
}

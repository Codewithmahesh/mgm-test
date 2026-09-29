'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { loader } from '@monaco-editor/react'
import { LANGUAGE_OPTIONS } from '@/lib/api'

const Monaco = dynamic(() => import('@monaco-editor/react').then(mod => mod.default), {
  ssr: false,
  loading: () => <EditorLoading />,
})

function EditorLoading() {
  return <div className="flex h-full min-h-40 items-center justify-center bg-[#1e1e1e] text-xs text-white/50">Loading editor…</div>
}

const LOAD_TIMEOUT_MS = 10_000
let monacoState: 'loading' | 'ready' | 'failed' = 'loading'

/**
 * Monaco (VS Code) editor, loaded from the jsDelivr CDN on first use. If the CDN is blocked or
 * slow (some campus networks), it falls back to a plain code box so students can still answer.
 */
export function CodeEditor({ value, onChange, language, readOnly = false, height = '100%' }: { value: string; onChange?: (value: string) => void; language: string; readOnly?: boolean; height?: string | number }) {
  const [state, setState] = useState(monacoState)
  const monacoLanguage = LANGUAGE_OPTIONS.find(option => option.value === language)?.monaco ?? 'plaintext'

  useEffect(() => {
    if (state !== 'loading') return
    let settled = false
    const timer = window.setTimeout(() => { if (!settled) { monacoState = 'failed'; setState('failed') } }, LOAD_TIMEOUT_MS)
    loader.init()
      .then(() => { settled = true; if (monacoState !== 'failed') { monacoState = 'ready'; setState('ready') } })
      .catch(() => { settled = true; monacoState = 'failed'; setState('failed') })
    return () => window.clearTimeout(timer)
  }, [state])

  if (state === 'failed') return <FallbackEditor value={value} onChange={onChange} readOnly={readOnly} height={height} />
  if (state === 'loading') return <div style={{ height }}><EditorLoading /></div>

  return (
    <Monaco
      height={height}
      theme="vs-dark"
      language={monacoLanguage}
      value={value}
      onChange={next => onChange?.(next ?? '')}
      options={{
        readOnly,
        fontSize: 14,
        fontFamily: 'var(--font-jetbrains), ui-monospace, monospace',
        fontLigatures: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        padding: { top: 12, bottom: 12 },
        renderLineHighlight: readOnly ? 'none' : 'line',
        smoothScrolling: true,
        contextmenu: !readOnly,
        wordWrap: readOnly ? 'on' : 'off',
        bracketPairColorization: { enabled: true },
        autoClosingBrackets: 'always',
        autoClosingQuotes: 'always',
        matchBrackets: 'always',
        formatOnPaste: true,
        suggestOnTriggerCharacters: true,
      }}
    />
  )
}

/** Plain monospace editor: Tab inserts four spaces. */
function FallbackEditor({ value, onChange, readOnly, height }: { value: string; onChange?: (value: string) => void; readOnly: boolean; height: string | number }) {
  return (
    <textarea
      data-code-editor
      value={value}
      readOnly={readOnly}
      spellCheck={false}
      aria-label="Code"
      onChange={event => onChange?.(event.target.value)}
      onKeyDown={event => {
        if (event.key !== 'Tab' || readOnly) return
        event.preventDefault()
        const el = event.currentTarget
        const { selectionStart, selectionEnd } = el
        const next = `${value.slice(0, selectionStart)}    ${value.slice(selectionEnd)}`
        onChange?.(next)
        requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = selectionStart + 4 })
      }}
      style={{ height }}
      className="block w-full resize-none bg-[#1e1e1e] p-4 font-mono text-sm leading-6 text-[#e7ecf5] outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
    />
  )
}

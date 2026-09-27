'use client'

import { useState } from 'react'
import { BLOOM_INFO, type BloomLevel } from '@/lib/bloom'
import { Check, Copy } from 'lucide-react'
import { Badge } from '@/components/ui/card'
import { statusMeta, type RoomStatus } from '@/lib/api'
import { cn } from '@/lib/utils'

export function RoomStatusBadge({ status }: { status: RoomStatus }) {
  const meta = statusMeta[status] ?? statusMeta.draft
  return <Badge tone={meta.tone} dot>{meta.label}</Badge>
}

export function CopyCode({ code, large = false, className }: { code: string; large?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={event => { event.stopPropagation(); event.preventDefault(); navigator.clipboard?.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1500) }}
      title="Copy room code"
      className={cn('inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/60 font-mono font-semibold tracking-[0.12em] text-foreground hover:border-border-strong', large ? 'px-3 py-1.5 text-xl' : 'px-2 py-0.5 text-xs', className)}
    >
      {code}
      {copied ? <Check className={cn('text-success', large ? 'size-4' : 'size-3')} /> : <Copy className={cn('text-subtle', large ? 'size-4' : 'size-3')} />}
    </button>
  )
}

export function TypeBadge({ type }: { type: 'mcq' | 'tf' | 'coding' | string }) {
  if (type === 'coding') return <Badge tone="violet">Coding</Badge>
  if (type === 'tf') return <Badge tone="neutral">True / False</Badge>
  return <Badge tone="blue">MCQ</Badge>
}

export function BloomBadge({ level }: { level: string | null | undefined }) {
  if (!level || !(level in BLOOM_INFO)) return null
  const info = BLOOM_INFO[level as BloomLevel]
  return <Badge tone={info.tone} className="font-medium" ><span className="font-mono">L{info.n}</span>{info.label}</Badge>
}

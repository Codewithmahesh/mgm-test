'use client'

import { useState } from 'react'
import { CheckCircle2, Trash2 } from 'lucide-react'
import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Alert, Field, Input } from '@/components/ui/form'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

const CONFIRM_WORD = 'DELETE'

/** Deletes an account by email and password (POST /api/account/delete), without signing in. */
export function DeleteAccountForm() {
  const [account, setAccount] = useState<'student' | 'teacher'>('student')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const ready = email.trim() !== '' && password !== '' && confirm.trim().toUpperCase() === CONFIRM_WORD

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!ready) return
    setDeleting(true)
    setError('')
    try {
      await api('/api/account/delete', { body: { account, email, password, confirm } })
      setDone(true)
    } catch (err) { setError(errorMessage(err)) } finally { setDeleting(false) }
  }

  if (done) return (
    <Card className="flex items-start gap-3 border-success-border bg-success-soft/40 p-5">
      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
      <div>
        <p className="font-semibold text-success">Your account has been deleted</p>
        <p className="mt-1 text-sm text-muted-foreground">Your account and everything in it are gone. We&apos;ve sent a confirmation to {email}.</p>
      </div>
    </Card>
  )

  return (
    <Card className="p-5">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <div role="radiogroup" aria-label="Account type" className="grid grid-cols-2 gap-2">
          {([['student', 'Student account'], ['teacher', 'Faculty account']] as const).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={account === value} onClick={() => setAccount(value)}
              className={cn('rounded-md border px-3 py-2.5 text-sm font-medium transition-colors', account === value ? 'border-primary bg-primary-soft/60 text-primary ring-1 ring-primary' : 'border-border hover:bg-muted')}>
              {label}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={account === 'student' ? 'College email' : 'Email'} htmlFor="del-email"><Input id="del-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@college.edu" /></Field>
          <Field label="Password" htmlFor="del-password"><PasswordInput id="del-password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></Field>
        </div>
        <Field label={<>Type <b className="font-mono">{CONFIRM_WORD}</b> to confirm</>} htmlFor="del-confirm" hint="Your account and everything in it are deleted for good, right away.">
          <Input id="del-confirm" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono sm:max-w-xs" />
        </Field>
        <Button type="submit" variant="destructive" loading={deleting} disabled={!ready} className="self-start"><Trash2 />{deleting ? 'Deleting…' : 'Delete my account permanently'}</Button>
      </form>
    </Card>
  )
}

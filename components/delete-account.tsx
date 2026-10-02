'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Alert, Field, Input } from '@/components/ui/form'
import { Dialog } from '@/components/ui/overlay'
import { api, errorMessage } from '@/lib/api'

const CONFIRM_WORD = 'DELETE'

const WHAT_GOES = {
  teacher: [
    'Your exam rooms, with every student attempt, answer and result in them',
    'Your question bank and AI generations',
    'Your practicals, their experiments and the students’ submissions',
    'Your profile and sign-in',
  ],
  student: [
    'Your exam attempts, answers and results',
    'Your practical submissions and AI practice problems',
    'Your profile and sign-in',
  ],
}

/**
 * "Delete account" for the faculty account page and the student profile: what will be deleted, then a
 * confirmation that needs the password and the word DELETE. Afterwards the person is signed out.
 */
export function DeleteAccountCard({ account }: { account: 'teacher' | 'student' }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const ready = password.length > 0 && confirm.trim().toUpperCase() === CONFIRM_WORD

  function close() { if (deleting) return; setOpen(false); setPassword(''); setConfirm(''); setError('') }

  async function remove() {
    setDeleting(true)
    setError('')
    try {
      await api(account === 'teacher' ? '/api/auth/me' : '/api/student/me', { method: 'DELETE', body: { password, confirm } })
      // Signed out by the server; leave the app.
      window.location.href = account === 'teacher' ? '/teacher/login?deleted=1' : '/student/login?deleted=1'
    } catch (err) { setError(errorMessage(err)); setDeleting(false) }
  }

  return (
    <>
      <Card className="border-danger-border">
        <CardHeader title={<span className="text-danger">Delete account</span>} description="Permanently delete your account and everything in it. This can't be undone." />
        <div className="flex flex-col gap-4 p-5 pt-4 sm:flex-row sm:items-end sm:justify-between">
          <ul className="flex flex-col gap-1 text-[13px] text-muted-foreground">
            {WHAT_GOES[account].map(item => <li key={item} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-danger" />{item}</li>)}
          </ul>
          <Button variant="destructive-outline" className="shrink-0" onClick={() => setOpen(true)}><Trash2 />Delete my account</Button>
        </div>
      </Card>

      <Dialog open={open} onClose={close} dismissible={!deleting} title="Delete your account?" description="Everything listed is deleted for good, right away. We'll email you once it's done."
        footer={<>
          <Button variant="outline" onClick={close} disabled={deleting}>Cancel</Button>
          <Button variant="destructive" onClick={remove} loading={deleting} disabled={!ready}><Trash2 />{deleting ? 'Deleting…' : 'Delete permanently'}</Button>
        </>}>
        <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); if (ready) void remove() }}>
          {error && <Alert>{error}</Alert>}
          {account === 'teacher' && <Alert tone="warning">Your students lose their attempts and results in your exams, and their work in your practicals.</Alert>}
          <Field label="Your password" htmlFor="delete-password"><PasswordInput id="delete-password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" autoFocus /></Field>
          <Field label={<>Type <b className="font-mono">{CONFIRM_WORD}</b> to confirm</>} htmlFor="delete-confirm">
            <Input id="delete-confirm" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono" />
          </Field>
          <button type="submit" hidden />
        </form>
      </Dialog>
    </>
  )
}

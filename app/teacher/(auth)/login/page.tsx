'use client'

import Link from 'next/link'
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AuthShell } from '@/components/auth-shell'
import { PasswordInput, safeNext } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import { Alert, Field, Input } from '@/components/ui/form'
import { api, errorMessage } from '@/lib/api'

function LoginForm() {
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      await api('/api/auth/login', { body: { email, password } })
      window.location.href = safeNext(params.get('next'), '/teacher')
    } catch (err) {
      setError(errorMessage(err))
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {params.get('deleted') && !error && <Alert tone="success">Your account and everything in it have been deleted.</Alert>}
      {error && <Alert>{error}</Alert>}
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" autoComplete="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)} placeholder="you@college.edu" />
      </Field>
      <Field label={<span className="flex w-full justify-between">Password<Link href="/teacher/forgot-password" className="font-normal text-primary hover:underline">Forgot password?</Link></span>} htmlFor="password">
        <PasswordInput id="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" size="lg" loading={loading} className="mt-2 w-full">{loading ? 'Signing in…' : 'Sign in'}</Button>
    </form>
  )
}

export default function TeacherLoginPage() {
  return (
    <AuthShell role="Faculty" title="Faculty sign in" subtitle="Welcome back. Enter your faculty account details." footer={<>New faculty member? <Link href="/teacher/signup" className="font-medium text-primary hover:underline">Create a faculty account</Link></>}>
      <Suspense><LoginForm /></Suspense>
    </AuthShell>
  )
}

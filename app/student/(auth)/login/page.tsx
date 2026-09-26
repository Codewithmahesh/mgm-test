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
      const data = await api<{ profileComplete: boolean }>('/api/student/auth/login', { body: { email, password } })
      window.location.href = data.profileComplete ? safeNext(params.get('next'), '/student') : '/student/profile'
    } catch (err) {
      setError(errorMessage(err))
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error && <Alert>{error}{error.includes('not activated') && <> <Link href="/student/activate" className="font-semibold underline">Activate now</Link></>}</Alert>}
      <Field label="College email" htmlFor="email">
        <Input id="email" type="email" autoComplete="email" required autoFocus value={email} onChange={e => setEmail(e.target.value.trim())} placeholder="sd24_name@mgmcen.ac.in" />
      </Field>
      <Field label={<span className="flex w-full justify-between">Password<Link href="/student/forgot-password" className="font-normal text-primary hover:underline">Forgot password?</Link></span>} htmlFor="password">
        <PasswordInput id="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" size="lg" disabled={loading} className="mt-2 w-full">{loading ? 'Signing in…' : 'Sign in'}</Button>
    </form>
  )
}

export default function StudentLoginPage() {
  return (
    <AuthShell role="Student" title="Student sign in" subtitle="Use your college email and portal password." footer={<>First time here? <Link href="/student/activate" className="font-medium text-primary hover:underline">Activate your account</Link></>}>
      <Suspense><LoginForm /></Suspense>
    </AuthShell>
  )
}

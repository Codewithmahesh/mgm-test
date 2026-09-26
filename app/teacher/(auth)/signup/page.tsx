'use client'

import Link from 'next/link'
import { useState } from 'react'
import { AuthShell } from '@/components/auth-shell'
import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import { Alert, Field, Input } from '@/components/ui/form'
import { api, errorMessage } from '@/lib/api'

export default function TeacherSignupPage() {
  const [form, setForm] = useState({ name: '', email: '', department: '', password: '', signupCode: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm(value => ({ ...value, [key]: event.target.value }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      await api('/api/auth/signup', { body: form })
      window.location.href = '/teacher'
    } catch (err) {
      setError(errorMessage(err))
      setLoading(false)
    }
  }

  return (
    <AuthShell role="Faculty" title="Create a faculty account" subtitle="Set up your workspace in under a minute." footer={<>Already have an account? <Link href="/teacher/login" className="font-medium text-primary hover:underline">Sign in</Link></>}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Full name" htmlFor="name" required>
          <Input id="name" autoComplete="name" required minLength={2} autoFocus value={form.name} onChange={set('name')} placeholder="Prof. Riya Sharma" />
        </Field>
        <Field label="Work email" htmlFor="email" required>
          <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} placeholder="you@college.edu" />
        </Field>
        <Field label="Department" htmlFor="department" hint="Shown to students on the exam page.">
          <Input id="department" value={form.department} onChange={set('department')} placeholder="Computer Science & Engineering" />
        </Field>
        <Field label="Password" htmlFor="password" required hint="At least 8 characters.">
          <PasswordInput id="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set('password')} />
        </Field>
        <Field label="Faculty sign-up code" htmlFor="signupCode" required hint="Provided by the college administrator. Keeps student data private to faculty.">
          <Input id="signupCode" required autoComplete="off" value={form.signupCode} onChange={set('signupCode')} className="font-mono" />
        </Field>
        <Button type="submit" size="lg" disabled={loading} className="mt-2 w-full">{loading ? 'Creating account…' : 'Create account'}</Button>
      </form>
    </AuthShell>
  )
}

'use client'

import Link from 'next/link'
import { useState } from 'react'
import { AuthShell } from '@/components/auth-shell'
import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import { Alert, Field, Input, Select } from '@/components/ui/form'
import { DEPARTMENT_OPTIONS, api, errorMessage } from '@/lib/api'

export default function TeacherSignupPage() {
  const [form, setForm] = useState({ name: '', email: '', department: '', password: '', signupCode: '' })
  const [isCustomDept, setIsCustomDept] = useState(false)
  const [customDept, setCustomDept] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(value => ({ ...value, [key]: event.target.value }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const finalDepartment = isCustomDept ? customDept.trim() : form.department
      if (!finalDepartment) {
        throw new Error('Please select or enter your department.')
      }
      await api('/api/auth/signup', { body: { ...form, department: finalDepartment } })
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
        <Field label="Department" htmlFor="department" required hint="Shown to students on the exam page.">
          <Select
            id="department"
            required
            value={isCustomDept ? 'Other' : form.department}
            onChange={e => {
              if (e.target.value === 'Other') {
                setIsCustomDept(true)
                setForm(v => ({ ...v, department: '' }))
              } else {
                setIsCustomDept(false)
                setForm(v => ({ ...v, department: e.target.value }))
              }
            }}
          >
            <option value="" disabled>Select your department</option>
            {DEPARTMENT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
            <option value="Other">Other / Not in list…</option>
          </Select>
        </Field>
        {isCustomDept && (
          <Field label="Department name" htmlFor="customDept" required>
            <Input
              id="customDept"
              required
              value={customDept}
              onChange={e => setCustomDept(e.target.value)}
              placeholder="e.g. Data Science & Analytics"
              autoFocus
            />
          </Field>
        )}
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

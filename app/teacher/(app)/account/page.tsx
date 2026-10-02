'use client'

import { useEffect, useState } from 'react'
import { DeleteAccountCard } from '@/components/delete-account'
import { useTeacher } from '@/components/role-context'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, PageHeader, PageLoader } from '@/components/ui/card'
import { Alert, Field, Input } from '@/components/ui/form'
import { useFeedback } from '@/components/ui/overlay'
import { api, errorMessage } from '@/lib/api'

/** The faculty member's account: name and department, and deleting the account. */
export default function AccountPage() {
  const teacher = useTeacher()
  const { toast } = useFeedback()
  const [name, setName] = useState('')
  const [department, setDepartment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (teacher) { setName(teacher.name); setDepartment(teacher.department) } }, [teacher])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api('/api/auth/me', { method: 'PATCH', body: { name, department } })
      toast('Profile saved.')
      // The header shows the name from the layout; reload so it updates everywhere.
      window.location.reload()
    } catch (err) { setError(errorMessage(err)); setSaving(false) }
  }

  if (!teacher) return <PageLoader />
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Account" description={teacher.email} />
      <form onSubmit={save}>
        <Card>
          <CardHeader title="Profile" description="Your email is your sign-in and can't be changed." />
          <div className="flex flex-col gap-4 p-5">
            {error && <Alert>{error}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="name" required><Input id="name" value={name} onChange={e => setName(e.target.value)} required /></Field>
              <Field label="Department" htmlFor="department"><Input id="department" value={department} onChange={e => setDepartment(e.target.value)} /></Field>
            </div>
          </div>
          <div className="flex justify-end border-t border-border px-5 py-3">
            <Button type="submit" loading={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </Card>
      </form>
      <DeleteAccountCard account="teacher" />
    </div>
  )
}

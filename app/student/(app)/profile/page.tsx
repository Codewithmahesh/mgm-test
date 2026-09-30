'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useStudent } from '@/components/role-context'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, PageHeader } from '@/components/ui/card'
import { Alert, Field, Input, Select } from '@/components/ui/form'
import { useFeedback } from '@/components/ui/overlay'
import { useGibberishCheck } from '@/components/gibberish-check'
import { BRANCH_OPTIONS, Classroom, YEAR_OPTIONS, api, errorMessage } from '@/lib/api'

export default function ProfilePage() {
  const { student, refresh } = useStudent()
  const router = useRouter()
  const { toast } = useFeedback()
  const checkText = useGibberishCheck()
  const [form, setForm] = useState({ name: '', classroomId: '', year: '', branch: '', division: '', rollNumber: '', prn: '' })
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [customClass, setCustomClass] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const firstTime = student ? !student.profileComplete : false

  useEffect(() => {
    api<{ classrooms: Classroom[] }>('/api/classrooms')
      .then(data => setClassrooms(data.classrooms))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (student) {
      setForm({
        name: student.name,
        classroomId: student.classroomId ?? '',
        year: student.year,
        branch: student.branch,
        division: student.division,
        rollNumber: student.rollNumber,
        prn: student.prn,
      })
      // If student has a class that is not in the list once classrooms load, check if custom
      if (student.year && !student.classroomId) {
        setCustomClass(true)
      }
    }
  }, [student])

  // Try matching student to classroom if classroomId wasn't previously set
  useEffect(() => {
    if (student && classrooms.length > 0 && !form.classroomId && student.year && student.branch && student.division) {
      const match = classrooms.find(
        c => c.year.toLowerCase() === student.year.toLowerCase() &&
             c.branch.toLowerCase() === student.branch.toLowerCase() &&
             c.division.toLowerCase() === student.division.toLowerCase()
      )
      if (match) {
        setForm(v => ({ ...v, classroomId: match.id }))
      }
    }
  }, [classrooms, student, form.classroomId])

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(value => ({ ...value, [key]: event.target.value }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!(await checkText([{ label: 'Full name', value: form.name }]))) return
    setSaving(true)
    setError('')
    try {
      if (!customClass && !form.classroomId) {
        throw new Error('Please select your class from the dropdown.')
      }
      await api('/api/student/me', { method: 'PATCH', body: form })
      refresh()
      if (firstTime) router.push('/student')
      else toast('Profile saved.')
    } catch (err) { setError(errorMessage(err)) } finally { setSaving(false) }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={firstTime ? 'Complete your profile' : 'Your profile'} description={firstTime ? 'One last step. Your faculty sees these details on your results.' : 'Keep your details up to date.'} />
      {firstTime && student?.name && <Alert tone="info" className="mb-4">We&apos;ve filled in what your college has on record. Check it and correct anything that&apos;s wrong.</Alert>}
      <form onSubmit={submit}>
        <Card>
          <CardHeader title="Student details" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {error && <Alert className="sm:col-span-2">{error}</Alert>}
            <Field label="College email" className="sm:col-span-2" hint="Your sign-in email. Ask your faculty if it needs to change."><Input value={student?.email ?? ''} disabled /></Field>
            <Field label="Full name" required htmlFor="name" className="sm:col-span-2"><Input id="name" required minLength={2} value={form.name} onChange={set('name')} placeholder="As on your college ID" /></Field>
            
            {/* Class Dropdown */}
            <Field label="Class" required htmlFor="classroomId" className="sm:col-span-2" hint="Select your class and division (e.g. SY CSE A, B.Tech CSE B)">
              <Select
                id="classroomId"
                required
                value={customClass ? 'custom' : form.classroomId}
                onChange={e => {
                  const val = e.target.value
                  if (val === 'custom') {
                    setCustomClass(true)
                    setForm(v => ({ ...v, classroomId: '' }))
                  } else {
                    setCustomClass(false)
                    const selected = classrooms.find(c => c.id === val)
                    if (selected) {
                      setForm(v => ({
                        ...v,
                        classroomId: selected.id,
                        year: selected.year,
                        branch: selected.branch,
                        division: selected.division,
                      }))
                    }
                  }
                }}
              >
                <option value="" disabled>Select your class</option>
                {classrooms.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
                <option value="custom">Other / Not in list (Enter manually)…</option>
              </Select>
            </Field>

            {customClass && (
              <>
                <Field label="Year" required htmlFor="year"><Select id="year" required value={form.year} onChange={set('year')}><option value="" disabled>Select year</option>{YEAR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
                <Field label="Branch" required htmlFor="branch"><Select id="branch" required value={form.branch} onChange={set('branch')}><option value="" disabled>Select branch</option>{BRANCH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.value} — {o.label}</option>)}</Select></Field>
                <Field label="Division" required htmlFor="division"><Input id="division" required maxLength={2} value={form.division} onChange={e => setForm(v => ({ ...v, division: e.target.value.toUpperCase() }))} placeholder="A" /></Field>
              </>
            )}

            <Field label="Roll number" required htmlFor="roll"><Input id="roll" required value={form.rollNumber} onChange={set('rollNumber')} placeholder="e.g. 42" /></Field>
            <Field label="PRN" htmlFor="prn" hint="Permanent registration number, if you have one." className={customClass ? '' : 'sm:col-span-2'}><Input id="prn" value={form.prn} onChange={set('prn')} className="font-mono" /></Field>
          </div>
          <div className="flex justify-end border-t border-border px-5 py-3">
            <Button type="submit" disabled={!student} loading={saving}>{saving ? 'Saving…' : firstTime ? 'Save and continue' : 'Save changes'}</Button>
          </div>
        </Card>
      </form>
    </div>
  )
}

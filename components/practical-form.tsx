'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, Field, Input, Textarea } from '@/components/ui/form'
import { Dialog } from '@/components/ui/overlay'
import { api, errorMessage, type Classroom } from '@/lib/api'
import type { PracticalSubject } from '@/lib/practical-types'
import { cn } from '@/lib/utils'

/** Create or edit a practical subject: name, course code, description and the classes that take it. */
export function PracticalSubjectDialog({ open, initial, onClose, onSaved }: { open: boolean; initial: PracticalSubject | null; onClose: () => void; onSaved: (subject: PracticalSubject) => void }) {
  const [title, setTitle] = useState('')
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [classrooms, setClassrooms] = useState<Classroom[] | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(initial?.title ?? '')
    setCode(initial?.code ?? '')
    setDescription(initial?.description ?? '')
    setSelected(initial?.classrooms ?? [])
    setError('')
    api<{ classrooms: Classroom[] }>('/api/classrooms').then(d => setClassrooms(d.classrooms)).catch(err => setError(errorMessage(err)))
  }, [open, initial])

  async function save() {
    if (!title.trim()) return setError('Give the practical a name.')
    if (!selected.length) return setError('Choose at least one class.')
    setSaving(true)
    setError('')
    try {
      const body = { title, code, description, classrooms: selected }
      const data = initial
        ? await api<{ subject: PracticalSubject }>(`/api/practicals/${initial.id}`, { method: 'PATCH', body })
        : await api<{ subject: PracticalSubject }>('/api/practicals', { body })
      onSaved(data.subject)
      onClose()
    } catch (err) { setError(errorMessage(err)) } finally { setSaving(false) }
  }

  const toggle = (id: string) => setSelected(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))

  return (
    <Dialog open={open} onClose={onClose} size="lg" title={initial ? 'Practical settings' : 'New practical'} description="A practical is a lab subject: experiments students solve in order, one level at a time."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>{initial ? 'Save' : 'Create practical'}</Button></>}>
      <div className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <Field label="Subject" required><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Data Structures Lab" autoFocus /></Field>
          <Field label="Course code"><Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="CS301" /></Field>
        </div>
        <Field label="Description" hint="Optional. Shown to students."><Textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="What students practise in this lab" /></Field>
        <Field label="Classes" required hint="Every activated student in these classes gets this practical.">
          {!classrooms ? <p className="text-sm text-muted-foreground">Loading classes…</p> : classrooms.length === 0 ? <p className="text-sm text-muted-foreground">No classes yet. Add students with their class first.</p> : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {classrooms.map(classroom => {
                const checked = selected.includes(classroom.id)
                return (
                  <label key={classroom.id} className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-[13px]', checked ? 'border-primary bg-primary-soft/60' : 'border-border hover:bg-muted')}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(classroom.id)} className="size-4 accent-[var(--primary)]" />
                    <span className="flex-1 font-medium">{classroom.label}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{classroom.active}</span>
                  </label>
                )
              })}
            </div>
          )}
        </Field>
      </div>
    </Dialog>
  )
}

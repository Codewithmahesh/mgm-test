'use client'

import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import { Alert, Field, Input } from '@/components/ui/form'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

type Step = 'email' | 'code' | 'password'

const ENDPOINTS = {
  student: { send: '/api/student/auth/otp', verify: '/api/student/auth/verify', password: '/api/student/auth/password' },
  teacher: { send: '/api/auth/forgot-password', verify: '/api/auth/verify-otp', password: '/api/auth/reset-password' },
}

/**
 * Email → 6-digit OTP → new password. Used for student activation, and for password reset
 * by both students and faculty.
 */
export function OtpFlow({ purpose, account = 'student' }: { purpose: 'activate' | 'reset'; account?: 'student' | 'teacher' }) {
  const urls = ENDPOINTS[account]
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''))
  const [ticket, setTicket] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const boxes = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown(value => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  async function run(action: () => Promise<void>) {
    setLoading(true)
    setError('')
    try { await action() } catch (err) { setError(errorMessage(err)) } finally { setLoading(false) }
  }

  const requestCode = () => run(async () => {
    const data = await api<{ message: string }>(urls.send, { body: { email, purpose } })
    setInfo(data.message)
    setDigits(Array(6).fill(''))
    setStep('code')
    setCooldown(45)
    window.setTimeout(() => boxes.current[0]?.focus(), 50)
  })

  const verifyCode = (code = digits.join('')) => run(async () => {
    if (code.length !== 6) throw new Error('Enter all 6 digits.')
    const data = await api<{ ticket: string }>(urls.verify, { body: { email, otp: code, purpose } })
    setTicket(data.ticket)
    setInfo('')
    setStep('password')
  })

  const savePassword = () => run(async () => {
    if (password !== confirm) throw new Error('The two passwords do not match.')
    const data = await api<{ profileComplete?: boolean }>(urls.password, { body: { ticket, password } })
    window.location.href = account === 'teacher' ? '/teacher' : data.profileComplete ? '/student' : '/student/profile'
  })

  function typeDigit(index: number, value: string) {
    const clean = value.replace(/\D/g, '')
    if (clean.length > 1) {
      const next = clean.slice(0, 6).split('')
      const filled = Array(6).fill('').map((_, i) => next[i] ?? '')
      setDigits(filled)
      boxes.current[Math.min(5, next.length)]?.focus()
      if (next.length === 6) verifyCode(filled.join(''))
      return
    }
    const next = [...digits]
    next[index] = clean
    setDigits(next)
    if (clean && index < 5) boxes.current[index + 1]?.focus()
    if (clean && index === 5 && next.every(Boolean)) verifyCode(next.join(''))
  }

  const labels = [account === 'teacher' ? 'Email' : 'College email', 'Verify code', 'Set password']
  const current = ['email', 'code', 'password'].indexOf(step)

  return (
    <div>
      <ol className="mb-7 flex items-center gap-2" aria-label="Progress">
        {labels.map((label, index) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', index < current ? 'bg-success text-white' : index === current ? 'bg-primary text-white' : 'bg-muted text-muted-foreground')}>{index < current ? <Check className="size-3.5" /> : index + 1}</span>
            <span className={cn('truncate text-xs font-medium', index === current ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
            {index < labels.length - 1 && <span className="h-px flex-1 bg-border" />}
          </li>
        ))}
      </ol>

      {error && <Alert className="mb-4">{error}</Alert>}
      {info && !error && <Alert tone="info" className="mb-4">{info}</Alert>}

      {step === 'email' && (
        <form onSubmit={e => { e.preventDefault(); requestCode() }} className="flex flex-col gap-4">
          <Field label={account === 'teacher' ? 'Email' : 'College email'} htmlFor="email" hint={purpose === 'activate' ? 'Use the email your faculty added, e.g. sd24_name@mgmcen.ac.in' : 'The email you use to sign in.'}>
            <Input id="email" type="email" autoComplete="email" required autoFocus value={email} onChange={e => setEmail(e.target.value.trim())} placeholder={account === 'teacher' ? 'you@college.edu' : 'sd24_name@mgmcen.ac.in'} />
          </Field>
          <Button type="submit" size="lg" disabled={loading} className="mt-2 w-full">{loading ? 'Sending code…' : 'Send verification code'}</Button>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={e => { e.preventDefault(); verifyCode() }} className="flex flex-col gap-5">
          <div>
            <p className="mb-3 text-sm text-muted-foreground">Enter the 6-digit code sent to <span className="font-medium text-foreground">{email}</span>.</p>
            <div className="flex justify-between gap-2">
              {digits.map((digit, index) => (
                <input key={index} ref={el => { boxes.current[index] = el }} value={digit} inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} aria-label={`Digit ${index + 1}`}
                  onChange={e => typeDigit(index, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Backspace' && !digit && index > 0) boxes.current[index - 1]?.focus() }}
                  className="h-12 w-full rounded-md border border-input bg-card text-center font-mono text-xl font-semibold shadow-xs focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15" />
              ))}
            </div>
          </div>
          <Button type="submit" size="lg" disabled={loading} className="w-full">{loading ? 'Verifying…' : 'Verify code'}</Button>
          <div className="flex items-center justify-between text-[13px]">
            <button type="button" onClick={() => { setStep('email'); setInfo('') }} className="text-muted-foreground hover:text-foreground">Change email</button>
            <button type="button" disabled={cooldown > 0 || loading} onClick={requestCode} className="font-medium text-primary disabled:text-subtle">{cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}</button>
          </div>
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={e => { e.preventDefault(); savePassword() }} className="flex flex-col gap-4">
          <Field label="New password" htmlFor="password" hint="At least 8 characters.">
            <PasswordInput id="password" autoComplete="new-password" required minLength={8} autoFocus value={password} onChange={e => setPassword(e.target.value)} />
          </Field>
          <Field label="Confirm password" htmlFor="confirm">
            <PasswordInput id="confirm" autoComplete="new-password" required minLength={8} value={confirm} onChange={e => setConfirm(e.target.value)} />
          </Field>
          <Button type="submit" size="lg" disabled={loading} className="mt-2 w-full">{loading ? 'Saving…' : purpose === 'activate' ? 'Activate account' : 'Save new password'}</Button>
        </form>
      )}
    </div>
  )
}

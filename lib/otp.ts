import 'server-only'
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import type { Types } from 'mongoose'
import { HttpError } from './auth'
import { sendMail } from './mail'
import { PasswordReset } from './models'

// One-time codes for student activation and for password resets (students and faculty).

export type OtpAccount = 'teacher' | 'student'
export type OtpPurpose = 'activate' | 'reset'

const OTP_MINUTES = 10
const OTP_MAX_TRIES = 5

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const recordId = (account: OtpAccount, id: Types.ObjectId | string) => `otp:${account}:${id}`

/** Creates a fresh 6-digit code and emails it. Replaces any earlier code for the same account. */
export async function sendOtp(account: OtpAccount, user: { _id: Types.ObjectId; email: string; name?: string | null }, purpose: OtpPurpose) {
  const otp = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await PasswordReset.findOneAndUpdate(
    { _id: recordId(account, user._id) },
    { role: account, purpose, account: user._id, otpHash: hash(`${user._id}:${otp}`), attempts: 0, expiresAt: new Date(Date.now() + OTP_MINUTES * 60_000) },
    { upsert: true },
  )
  const action = purpose === 'activate' ? 'activate your examination portal account' : 'reset your examination portal password'
  await sendMail({
    to: user.email,
    subject: `${otp} is your MGM exam portal verification code`,
    text: `Hi${user.name ? ` ${user.name}` : ''},\n\nUse this code to ${action}: ${otp}\n\nIt expires in ${OTP_MINUTES} minutes. If you didn't request it, you can ignore this email.\n\n— Online Examination Portal, MGM's College of Engineering, Nanded`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;color:#0f172a"><p style="margin:0 0 16px;color:#64748b;font-size:13px">MGM's College of Engineering, Nanded · Online Examination Portal</p><h2 style="margin:0 0 12px">Your verification code</h2><p>Use this code to ${action}:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:16px 0;font-family:monospace">${otp}</p><p style="color:#64748b;font-size:13px">It expires in ${OTP_MINUTES} minutes. If you didn't request it, you can ignore this email.</p></div>`,
  })
}

/** Checks a code. Each wrong guess counts; after 5 the code is burned. A correct code can be used once. */
export async function verifyOtp(account: OtpAccount, userId: Types.ObjectId, otp: string, purpose: OtpPurpose) {
  const record = await PasswordReset.findOne({ _id: recordId(account, userId), expiresAt: { $gt: new Date() } })
  if (!record || (record.purpose ?? 'reset') !== purpose || !record.otpHash) throw new HttpError(400, 'This code has expired. Request a new one.')
  if (record.attempts >= OTP_MAX_TRIES) {
    await record.deleteOne()
    throw new HttpError(400, 'Too many wrong codes. Request a new one.')
  }
  const expected = Buffer.from(record.otpHash, 'hex')
  const given = Buffer.from(hash(`${userId}:${otp.trim()}`), 'hex')
  if (!timingSafeEqual(expected, given)) {
    record.attempts += 1
    await record.save()
    const left = OTP_MAX_TRIES - record.attempts
    throw new HttpError(400, left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong codes. Request a new one.')
  }
  await record.deleteOne()
}

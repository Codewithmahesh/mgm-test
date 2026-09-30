import 'server-only'
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import type { Types } from 'mongoose'
import { HttpError } from './auth'
import { renderEmail } from './email-template'
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
  const activating = purpose === 'activate'
  await sendMail({
    to: user.email,
    subject: `${otp} is your MGM exam portal verification code`,
    ...renderEmail({
      preview: `Your code is ${otp}. It expires in ${OTP_MINUTES} minutes.`,
      tag: activating ? 'Account activation' : 'Password reset',
      heading: activating ? 'Activate your account' : 'Reset your password',
      greeting: `Hi ${user.name || 'there'},`,
      paragraphs: [activating ? 'Enter this code on the portal to activate your examination account:' : 'Enter this code on the portal to choose a new password:'],
      code: otp,
      callout: { text: `The code expires in ${OTP_MINUTES} minutes and works only once. Never share it with anyone.` },
      footnote: activating ? "If you didn't try to activate an account, you can ignore this email." : "If you didn't ask to reset your password, ignore this email; your password stays the same.",
    }),
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

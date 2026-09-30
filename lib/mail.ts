import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'
import { HttpError } from './auth'
import { COLLEGE_NAME } from '@/components/brand'

type Mail = { to: string; subject: string; text: string; html: string }

/** Every email shows the college as the sender, whatever name MAIL_FROM or the mailbox carries. */
const SENDER_NAME = process.env.MAIL_FROM_NAME || COLLEGE_NAME

/** The address part of MAIL_FROM ("Name <a@b.c>" or "a@b.c"), falling back to the SMTP login. */
function senderAddress() {
  const from = (process.env.MAIL_FROM || '').trim()
  return from.match(/<([^>]+)>/)?.[1]?.trim() || (from.includes('@') ? from : '') || process.env.SMTP_USER || ''
}

let transporter: Transporter | null = null

/** Sends through SMTP when SMTP_HOST is set; otherwise prints the email to the server console (dev). */
export async function sendMail(mail: Mail) {
  const host = process.env.SMTP_HOST
  if (!host) {
    console.info(`\n[mail] SMTP_HOST is empty, printing instead of sending.\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`)
    return
  }
  const port = Number(process.env.SMTP_PORT) || 465
  transporter ??= nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  })
  try {
    await transporter.sendMail({ from: { name: SENDER_NAME, address: senderAddress() }, ...mail })
    console.info(`[mail] sent "${mail.subject}" to ${mail.to}`)
  } catch (error) {
    console.error('[mail] send failed:', error)
    transporter = null
    throw new HttpError(502, "We couldn't send the email right now. Please try again in a minute.")
  }
}

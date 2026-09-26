import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'
import { HttpError } from './auth'

type Mail = { to: string; subject: string; text: string; html: string }

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
    await transporter.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, ...mail })
  } catch (error) {
    console.error('[mail] send failed:', error)
    transporter = null
    throw new HttpError(502, "We couldn't send the email right now. Please try again in a minute.")
  }
}

import 'server-only'
import { COLLEGE_CITY, COLLEGE_NAME, PORTAL_NAME } from '@/components/brand'

// Branded HTML emails. Mail clients ignore <style> blocks and modern CSS, so everything is
// table-based with inline styles, and every email also gets a plain-text version.

const C = { ink: '#181715', body: '#3d3a36', muted: '#7a756e', line: '#ebe6df', page: '#f5f1ec', card: '#ffffff', primary: '#c6613f', soft: '#f7ebe5', gold: '#e8a55a', warnBg: '#fff6e5', warnInk: '#8a5a00' }
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/** Public address of the portal, for links and the logo. Emails are sent without them when it isn't set. */
export const appUrl = () => (process.env.APP_URL || '').replace(/\/+$/, '')

const TIME_ZONE = process.env.APP_TIME_ZONE || 'Asia/Kolkata'

/** "Tue, 7 Oct 2026, 10:30 am" in the college's time zone (servers usually run on UTC). */
export function formatWhen(date: Date) {
  return date.toLocaleString('en-IN', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function formatTime(date: Date) {
  return date.toLocaleTimeString('en-IN', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' })
}

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export type EmailContent = {
  /** Shown in the inbox list after the subject. */
  preview: string
  /** Small coloured label above the heading, e.g. "Exam scheduled". */
  tag?: string
  heading: string
  greeting?: string
  /** Plain-text paragraphs (escaped here). */
  paragraphs: string[]
  /** A big code, e.g. an OTP. */
  code?: string
  /** Label/value rows shown as a card. */
  details?: [string, string][]
  /** Highlighted call-out, e.g. what the faculty member has to do. */
  callout?: { tone?: 'info' | 'warn'; text: string }
  button?: { label: string; path: string }
  /** Small print under everything else. */
  footnote?: string
}

export function renderEmail(content: EmailContent) {
  const url = appUrl()
  const button = content.button && url ? { label: content.button.label, href: `${url}${content.button.path}` } : null
  return { html: html(content, url, button), text: text(content, button) }
}

function html(c: EmailContent, url: string, button: { label: string; href: string } | null) {
  const p = (value: string, style = '') => `<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:${C.body};${style}">${escapeHtml(value)}</p>`
  const logo = url
    ? `<img src="${url}/mgm-logo.png" width="44" height="44" alt="" style="display:block;width:44px;height:44px;border:0;border-radius:8px;background:#ffffff">`
    : `<div style="width:44px;height:44px;border-radius:8px;background:${C.gold};color:${C.ink};font:700 15px/44px ${FONT};text-align:center">MGM</div>`
  const tone = c.callout?.tone === 'warn' ? { bg: C.warnBg, ink: C.warnInk, bar: C.gold } : { bg: C.soft, ink: '#97462b', bar: C.primary }

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escapeHtml(c.heading)}</title></head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(c.preview)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${FONT}">

<tr><td style="background:${C.ink};border-radius:14px 14px 0 0;padding:22px 28px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle">${logo}</td>
    <td style="vertical-align:middle;padding-left:14px">
      <div style="font-size:16px;font-weight:700;line-height:20px;color:#ffffff">${escapeHtml(COLLEGE_NAME)}, ${escapeHtml(COLLEGE_CITY)}</div>
      <div style="font-size:12px;line-height:18px;color:${C.gold};letter-spacing:.4px;text-transform:uppercase">${escapeHtml(PORTAL_NAME)}</div>
    </td>
  </tr></table>
</td></tr>
<tr><td style="height:4px;background:${C.primary};line-height:4px;font-size:0">&nbsp;</td></tr>

<tr><td style="background:${C.card};padding:32px 28px 28px">
  ${c.tag ? `<div style="display:inline-block;margin:0 0 12px;padding:4px 10px;border-radius:999px;background:${C.soft};color:${C.primary};font-size:12px;font-weight:600;letter-spacing:.3px">${escapeHtml(c.tag)}</div>` : ''}
  <h1 style="margin:0 0 18px;font-size:23px;line-height:30px;font-weight:700;color:${C.ink}">${escapeHtml(c.heading)}</h1>
  ${c.greeting ? p(c.greeting) : ''}
  ${c.paragraphs.map(value => p(value)).join('')}
  ${c.code ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 20px"><tr><td align="center" style="background:${C.soft};border:1px dashed ${C.primary};border-radius:12px;padding:20px">
    <div style="font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:36px;line-height:40px;font-weight:700;letter-spacing:10px;color:${C.ink}">${escapeHtml(c.code)}</div>
  </td></tr></table>` : ''}
  ${c.details?.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 20px;border:1px solid ${C.line};border-radius:12px;border-collapse:separate">
    ${c.details.map(([label, value], i) => `<tr>
      <td style="padding:11px 16px;font-size:13px;color:${C.muted};white-space:nowrap;vertical-align:top;${i ? `border-top:1px solid ${C.line};` : ''}">${escapeHtml(label)}</td>
      <td style="padding:11px 16px;font-size:14px;font-weight:600;color:${C.ink};text-align:right;${i ? `border-top:1px solid ${C.line};` : ''}">${escapeHtml(value)}</td>
    </tr>`).join('')}
  </table>` : ''}
  ${c.callout ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr>
    <td style="width:4px;background:${tone.bar};border-radius:4px 0 0 4px"></td>
    <td style="background:${tone.bg};border-radius:0 8px 8px 0;padding:13px 16px;font-size:14px;line-height:22px;color:${tone.ink}">${escapeHtml(c.callout.text)}</td>
  </tr></table>` : ''}
  ${button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 8px"><tr><td style="border-radius:10px;background:${C.primary}">
    <a href="${escapeHtml(button.href)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">${escapeHtml(button.label)} &rarr;</a>
  </td></tr></table>` : ''}
  ${c.footnote ? `<p style="margin:18px 0 0;padding-top:16px;border-top:1px solid ${C.line};font-size:13px;line-height:20px;color:${C.muted}">${escapeHtml(c.footnote)}</p>` : ''}
</td></tr>

<tr><td style="background:${C.card};border-top:1px solid ${C.line};border-radius:0 0 14px 14px;padding:18px 28px;font-size:12px;line-height:18px;color:${C.muted}">
  ${escapeHtml(PORTAL_NAME)} · ${escapeHtml(COLLEGE_NAME)}, ${escapeHtml(COLLEGE_CITY)}<br>This is an automated message; replies to it aren't read.${url ? ` <a href="${url}" style="color:${C.primary};text-decoration:none">Open the portal</a>` : ''}
</td></tr>

</table>
</td></tr></table>
</body></html>`
}

function text(c: EmailContent, button: { label: string; href: string } | null) {
  return [
    c.heading.toUpperCase(),
    c.greeting ?? '',
    ...c.paragraphs,
    c.code ? `    ${c.code}` : '',
    c.details?.map(([label, value]) => `${label}: ${value}`).join('\n') ?? '',
    c.callout?.text ?? '',
    button ? `${button.label}: ${button.href}` : '',
    c.footnote ?? '',
    `— ${PORTAL_NAME}, ${COLLEGE_NAME}, ${COLLEGE_CITY}`,
  ].filter(Boolean).join('\n\n')
}

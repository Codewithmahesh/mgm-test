'use client'

import type { jsPDF as JsPDF } from 'jspdf'
import type { BankQuestion } from './api'

export type PaperMeta = {
  title: string
  code?: string
  description?: string
  durationMinutes?: number
  marksPerQuestion?: number
  negativeMarks?: number
  codingMarks?: number
}

const COLLEGE = "MGM's College of Engineering, Nanded"
const PAGE = { w: 210, h: 297, margin: 18 }
const INK: [number, number, number] = [20, 20, 19]
const MUTED: [number, number, number] = [108, 106, 100]
const ACCENT: [number, number, number] = [198, 97, 63]
const GOOD: [number, number, number] = [37, 107, 58]

let fontCache: Promise<Record<string, string>> | null = null

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** DejaVu fonts (in /public/fonts) cover ≤, —, ✓, Greek letters and more, unlike the built-in PDF fonts. */
function loadFonts() {
  fontCache ??= Promise.all(
    ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf', 'DejaVuSansMono.ttf'].map(async file => [file, toBase64(await (await fetch(`/fonts/${file}`)).arrayBuffer())] as const),
  ).then(Object.fromEntries)
  return fontCache
}

/** A blank A4 document (mm) with the DejaVu fonts registered as 'DejaVu' (normal, bold) and 'DejaVuMono'. */
export async function newPdf() {
  const [{ jsPDF }, fonts] = await Promise.all([import('jspdf'), loadFonts()])
  const doc: JsPDF = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.addFileToVFS('DejaVuSans.ttf', fonts['DejaVuSans.ttf'])
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal')
  doc.addFileToVFS('DejaVuSans-Bold.ttf', fonts['DejaVuSans-Bold.ttf'])
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold')
  doc.addFileToVFS('DejaVuSansMono.ttf', fonts['DejaVuSansMono.ttf'])
  doc.addFont('DejaVuSansMono.ttf', 'DejaVuMono', 'normal')
  return doc
}

/**
 * Builds a printable A4 question paper and downloads it. With `withAnswers`, correct options are
 * ticked, explanations are included and an answer key is added at the end.
 */
export async function downloadPaperPdf(meta: PaperMeta, questions: BankQuestion[], { withAnswers = false } = {}) {
  const doc = await newPdf()

  const width = PAGE.w - PAGE.margin * 2
  let y = PAGE.margin

  const font = (style: 'normal' | 'bold' = 'normal', size = 10.5, color: [number, number, number] = INK, family = 'DejaVu') => {
    doc.setFont(family, style)
    doc.setFontSize(size)
    doc.setTextColor(...color)
  }
  const lineHeight = (size: number) => size * 0.42
  const ensure = (needed: number) => {
    if (y + needed > PAGE.h - PAGE.margin - 8) { doc.addPage(); y = PAGE.margin }
  }
  /** Writes wrapped text at x, moving y down; splits across pages when needed. */
  type WriteOptions = { x?: number; size?: number; style?: 'normal' | 'bold'; color?: [number, number, number]; family?: string; maxWidth?: number; gap?: number }
  const write = (text: string, options: WriteOptions = {}) => {
    const { x = PAGE.margin, size = 10.5, style = 'normal', color = INK, family = 'DejaVu', gap = 1.2 } = options
    const maxWidth = options.maxWidth ?? width - (x - PAGE.margin)
    font(style, size, color, family)
    const lines: string[] = doc.splitTextToSize(text || ' ', maxWidth)
    for (const line of lines) {
      ensure(lineHeight(size))
      doc.text(line, x, y + lineHeight(size) * 0.8)
      y += lineHeight(size)
    }
    y += gap
  }

  // Header
  font('bold', 10, MUTED)
  doc.text(COLLEGE.toUpperCase(), PAGE.margin, y + 3)
  font('normal', 9, MUTED)
  doc.text('Online Examination Portal', PAGE.w - PAGE.margin, y + 3, { align: 'right' })
  y += 7
  write(meta.title, { size: 17, style: 'bold', gap: 1.5 })
  const mcqs = questions.filter(q => q.type !== 'coding')
  const coding = questions.filter(q => q.type === 'coding')
  const details = [
    meta.code && `Room ${meta.code}`,
    meta.durationMinutes && `${meta.durationMinutes} minutes`,
    `${mcqs.length} objective${coding.length ? ` · ${coding.length} coding` : ''} question${questions.length === 1 ? '' : 's'}`,
    meta.marksPerQuestion != null && mcqs.length ? `${meta.marksPerQuestion} mark${meta.marksPerQuestion === 1 ? '' : 's'} per MCQ${meta.negativeMarks ? `, −${meta.negativeMarks} for a wrong answer` : ''}` : '',
    withAnswers ? 'WITH ANSWERS — for faculty use' : '',
  ].filter(Boolean).join('   ·   ')
  write(details, { size: 9, color: withAnswers ? ACCENT : MUTED, gap: 2 })
  if (meta.description) write(meta.description, { size: 9.5, color: MUTED, gap: 2 })
  doc.setDrawColor(...ACCENT)
  doc.setLineWidth(0.6)
  doc.line(PAGE.margin, y, PAGE.margin + 24, y)
  doc.setDrawColor(230, 223, 216)
  doc.setLineWidth(0.2)
  doc.line(PAGE.margin + 24, y, PAGE.w - PAGE.margin, y)
  y += 6

  const section = (label: string) => {
    ensure(12)
    font('bold', 9, ACCENT)
    doc.text(label.toUpperCase(), PAGE.margin, y + 3)
    y += 7
  }

  // Objective questions
  if (mcqs.length) section(`Section A · Multiple choice (${mcqs.length})`)
  mcqs.forEach((q, index) => {
    ensure(18)
    const number = `${index + 1}.`
    font('bold', 10.5)
    doc.text(number, PAGE.margin, y + lineHeight(10.5) * 0.8)
    write(q.text, { x: PAGE.margin + 8, style: 'bold', gap: 1.8 })
    q.options.forEach((option, i) => {
      const correct = withAnswers && i === q.correctIndex
      write(`(${String.fromCharCode(65 + i)})  ${option}${correct ? '   ✓' : ''}`, { x: PAGE.margin + 11, size: 10, color: correct ? GOOD : INK, style: correct ? 'bold' : 'normal', gap: 0.6 })
    })
    if (withAnswers && q.explanation) write(`Explanation: ${q.explanation}`, { x: PAGE.margin + 11, size: 9, color: MUTED, gap: 0.6 })
    y += 4
  })

  // Coding problems
  if (coding.length) {
    if (mcqs.length) y += 2
    section(`Section ${mcqs.length ? 'B' : 'A'} · Coding (${coding.length})`)
  }
  coding.forEach((q, index) => {
    ensure(24)
    write(`P${index + 1}.  ${q.title || 'Coding problem'}${q.points ?? meta.codingMarks ? `   (${q.points ?? meta.codingMarks} marks)` : ''}`, { size: 12, style: 'bold', gap: 2 })
    write(q.text, { gap: 2.5 })
    const block = (label: string, text: string) => { if (!text?.trim()) return; write(label, { size: 9.5, style: 'bold', color: MUTED, gap: 0.8 }); write(text, { gap: 2.5 }) }
    block('Input format', q.inputFormat)
    block('Output format', q.outputFormat)
    block('Constraints', q.constraints)
    q.samples.forEach((sample, i) => {
      write(`Sample ${i + 1}`, { size: 9.5, style: 'bold', color: MUTED, gap: 1 })
      const box = (label: string, text: string) => {
        font('normal', 9, INK, 'DejaVuMono')
        const lines: string[] = doc.splitTextToSize(text || ' ', width - 10)
        const h = lines.length * lineHeight(9) + 7
        ensure(h + 2)
        doc.setFillColor(245, 240, 232)
        doc.roundedRect(PAGE.margin, y, width, h, 1.5, 1.5, 'F')
        font('bold', 7.5, MUTED)
        doc.text(label.toUpperCase(), PAGE.margin + 3, y + 3.8)
        font('normal', 9, INK, 'DejaVuMono')
        lines.forEach((line, n) => doc.text(line, PAGE.margin + 3, y + 7.5 + n * lineHeight(9)))
        y += h + 2
      }
      box('Input', sample.input)
      box('Output', sample.output)
      if (sample.explanation) write(`Explanation: ${sample.explanation}`, { size: 9, color: MUTED, gap: 2 })
    })
    y += 5
  })

  // Answer key
  if (withAnswers && mcqs.length) {
    ensure(20)
    y += 2
    section('Answer key')
    const perRow = 8
    const cell = width / perRow
    for (let i = 0; i < mcqs.length; i += perRow) {
      ensure(8)
      mcqs.slice(i, i + perRow).forEach((q, j) => {
        font('normal', 9, MUTED)
        doc.text(`${i + j + 1}.`, PAGE.margin + j * cell, y + 4)
        font('bold', 10, GOOD)
        doc.text(q.correctIndex == null ? '—' : String.fromCharCode(65 + q.correctIndex), PAGE.margin + j * cell + 8, y + 4)
      })
      y += 7
    }
  }

  // Footer on every page
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    doc.setDrawColor(230, 223, 216)
    doc.setLineWidth(0.2)
    doc.line(PAGE.margin, PAGE.h - 12, PAGE.w - PAGE.margin, PAGE.h - 12)
    font('normal', 8, MUTED)
    doc.text(`${meta.title}${withAnswers ? ' — with answers' : ''}`, PAGE.margin, PAGE.h - 7)
    doc.text(`Page ${page} of ${pages}`, PAGE.w - PAGE.margin, PAGE.h - 7, { align: 'right' })
  }

  const safe = meta.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'question-paper'
  doc.save(`${safe}${withAnswers ? '-with-answers' : '-question-paper'}.pdf`)
}

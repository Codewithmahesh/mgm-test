'use client'

import type { jsPDF as JsPDF } from 'jspdf'
import { formatDate, languageLabel } from './api'
import { newPdf } from './paper-pdf'
import type { PracticalReport, ReportEntry, ReportStatus } from './practical-types'

// The practical journal PDF: a cover with the student's details and an index (for a whole practical), then
// one section per experiment with the aim, the program, its output on the sample inputs and the result.
// Every state prints cleanly: solved, wrong output, compile error, nothing submitted, locked.

type Rgb = [number, number, number]
const COLLEGE = "MGM's College of Engineering, Nanded"
const PAGE = { w: 210, h: 297, margin: 16 }
const CONTENT_W = PAGE.w - PAGE.margin * 2
const BOTTOM = PAGE.h - PAGE.margin - 8
const INK: Rgb = [20, 20, 19]
const MUTED: Rgb = [108, 106, 100]
const RULE: Rgb = [226, 220, 212]
const ACCENT: Rgb = [198, 97, 63]
const PANEL: Rgb = [247, 244, 239]
const CODE_BG: Rgb = [246, 246, 244]

const STATUS: Record<ReportStatus, { label: string; color: Rgb; bg: Rgb }> = {
  solved: { label: 'Solved', color: [37, 107, 58], bg: [228, 243, 232] },
  not_solved: { label: 'Not solved', color: [150, 96, 10], bg: [252, 241, 220] },
  compile_error: { label: 'Compilation error', color: [178, 40, 40], bg: [251, 228, 228] },
  not_submitted: { label: 'Not submitted', color: MUTED, bg: [238, 236, 232] },
  locked: { label: 'Locked', color: MUTED, bg: [238, 236, 232] },
}

/** Tabs and stray control characters don't render in PDF fonts. */
const clean = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')

/** Builds the report PDF and downloads it. One entry gives an experiment sheet; several give a journal with an index. */
export async function downloadPracticalPdf(report: PracticalReport) {
  const doc = await newPdf()
  doc.save(drawPracticalPdf(doc, report))
}

/**
 * Draws the report on a blank A4 document (mm, DejaVu fonts registered) and returns a file name for it.
 * The mobile app (mgm-exam-app/src/lib/practical-pdf.ts) has a copy of this function: keep them in step.
 */
export function drawPracticalPdf(doc: JsPDF, report: PracticalReport) {
  const journal = report.entries.length !== 1
  let y = PAGE.margin

  const font = (style: 'normal' | 'bold' = 'normal', size = 10, color: Rgb = INK, family = 'DejaVu') => {
    doc.setFont(family, style)
    doc.setFontSize(size)
    doc.setTextColor(...color)
  }
  const lh = (size: number) => size * 0.42
  const newPage = () => { doc.addPage(); y = PAGE.margin }
  const ensure = (needed: number) => { if (y + needed > BOTTOM) newPage() }

  type WriteOptions = { x?: number; size?: number; style?: 'normal' | 'bold'; color?: Rgb; family?: string; maxWidth?: number; gap?: number }
  /** Wrapped text at x, moving y down and continuing on the next page when needed. */
  const write = (text: string, options: WriteOptions = {}) => {
    const { x = PAGE.margin, size = 10, style = 'normal', color = INK, family = 'DejaVu', gap = 1.2 } = options
    font(style, size, color, family)
    const lines: string[] = doc.splitTextToSize(clean(text) || ' ', options.maxWidth ?? CONTENT_W - (x - PAGE.margin))
    for (const line of lines) {
      ensure(lh(size) * 1.25)
      doc.text(line, x, y + lh(size))
      y += lh(size) * 1.25
    }
    y += gap
  }

  const heading = (label: string) => {
    ensure(30) // the heading and the start of its section, so a heading never ends a page alone
    y += 2
    font('bold', 9, ACCENT)
    doc.text(label.toUpperCase(), PAGE.margin, y + 3)
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.2)
    doc.line(PAGE.margin + doc.getTextWidth(label.toUpperCase()) + 3, y + 2, PAGE.w - PAGE.margin, y + 2)
    y += 7
  }

  const pill = (status: ReportStatus, x: number, top: number, align: 'left' | 'right' = 'left', label = STATUS[status].label) => {
    const { color, bg } = STATUS[status]
    font('bold', 8.5, color)
    const w = doc.getTextWidth(label) + 6
    const left = align === 'right' ? x - w : x
    doc.setFillColor(...bg)
    doc.roundedRect(left, top, w, 5.6, 2.8, 2.8, 'F')
    doc.text(label, left + 3, top + 3.9)
    return w
  }

  /**
   * Monospace text in a shaded box that may run over several pages. With `numbers`, each source line is
   * numbered (wrapped continuation lines are not).
   */
  const codeBox = (text: string, { numbers = false, size = 8.6, bg = CODE_BG, color = INK, label }: { numbers?: boolean; size?: number; bg?: Rgb; color?: Rgb; label?: string } = {}) => {
    const source = clean(text).replace(/\n+$/, '').split('\n')
    const gutter = numbers ? Math.max(2, String(source.length).length) * 1.9 + 4 : 0
    const pad = 3
    font('normal', size, color, 'DejaVuMono')
    const rows: { no: string; text: string }[] = []
    source.forEach((line, i) => {
      const parts: string[] = doc.splitTextToSize(line || ' ', CONTENT_W - pad * 2 - gutter)
      parts.forEach((part, j) => rows.push({ no: numbers && j === 0 ? String(i + 1) : '', text: part }))
    })
    const step = lh(size) * 1.3
    const labelH = label ? 5 : 0
    ensure(labelH + pad * 2 + step * Math.min(rows.length, 3))
    let i = 0
    let first = true
    while (i < rows.length || first) {
      const room = Math.max(1, Math.floor((BOTTOM - y - pad * 2 - (first ? labelH : 0)) / step))
      const chunk = rows.slice(i, i + room)
      const h = (first ? labelH : 0) + pad * 2 + step * Math.max(chunk.length, 1)
      doc.setFillColor(...bg)
      doc.roundedRect(PAGE.margin, y, CONTENT_W, h, 1.5, 1.5, 'F')
      let top = y + pad
      if (first && label) {
        font('bold', 7, MUTED)
        doc.text(label.toUpperCase(), PAGE.margin + pad, top + 2.4)
        top += labelH
      }
      if (numbers) {
        doc.setDrawColor(...RULE)
        doc.setLineWidth(0.2)
        doc.line(PAGE.margin + gutter, top - 1, PAGE.margin + gutter, top + step * chunk.length + 0.5)
      }
      chunk.forEach((row, n) => {
        const base = top + step * n + lh(size)
        if (row.no) { font('normal', size - 1, MUTED, 'DejaVuMono'); doc.text(row.no, PAGE.margin + gutter - 2, base, { align: 'right' }) }
        font('normal', size, color, 'DejaVuMono')
        doc.text(row.text, PAGE.margin + pad + gutter, base)
      })
      y += h + 2
      i += chunk.length
      first = false
      if (i < rows.length) newPage()
    }
  }

  /** Label/value pairs in a two-column grid inside a shaded panel. */
  const detailsPanel = (pairs: [string, string][]) => {
    const colW = CONTENT_W / 2
    const rowH = 10
    const rows = Math.ceil(pairs.length / 2)
    const h = rows * rowH + 4
    ensure(h + 2)
    doc.setFillColor(...PANEL)
    doc.roundedRect(PAGE.margin, y, CONTENT_W, h, 2, 2, 'F')
    pairs.forEach(([label, value], i) => {
      const x = PAGE.margin + 5 + (i % 2) * colW
      const top = y + 3 + Math.floor(i / 2) * rowH
      font('normal', 7.5, MUTED)
      doc.text(label.toUpperCase(), x, top + 3)
      font('bold', 10, INK)
      const fitted: string[] = doc.splitTextToSize(value || '—', colW - 8)
      doc.text(fitted[0] + (fitted.length > 1 ? '…' : ''), x, top + 7.6)
    })
    y += h + 4
  }

  const titleBlock = (title: string, subtitle: string) => {
    font('bold', 9, MUTED)
    doc.text(COLLEGE.toUpperCase(), PAGE.margin, y + 3)
    font('normal', 8.5, MUTED)
    doc.text('Practical Journal', PAGE.w - PAGE.margin, y + 3, { align: 'right' })
    y += 8
    write(title, { size: 16, style: 'bold', gap: 0.8 })
    if (subtitle) write(subtitle, { size: 9.5, color: MUTED, gap: 2 })
    doc.setDrawColor(...ACCENT)
    doc.setLineWidth(0.7)
    doc.line(PAGE.margin, y, PAGE.margin + 26, y)
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.2)
    doc.line(PAGE.margin + 26, y, PAGE.w - PAGE.margin, y)
    y += 5
  }

  const { student, subject } = report
  const subjectLine = [subject.code, subject.title].filter(Boolean).join(' · ')
  const studentPairs: [string, string][] = [
    ['Student name', student.name],
    ['Roll number', student.rollNumber],
    ['Class', student.classLabel],
    ['Subject', subjectLine],
  ]

  const signatures = () => {
    ensure(24)
    y += 10
    doc.setDrawColor(...MUTED)
    doc.setLineWidth(0.2)
    const w = 52
    const slots: [string, number][] = [["Student's signature", PAGE.margin], ['Date', PAGE.margin + (CONTENT_W - w) / 2], ["Faculty's signature", PAGE.w - PAGE.margin - w]]
    for (const [label, x] of slots) {
      doc.line(x, y, x + w, y)
      font('normal', 8, MUTED)
      doc.text(label, x + w / 2, y + 4, { align: 'center' })
    }
    y += 8
  }

  const experimentSection = (entry: ReportEntry) => {
    const title = `Experiment ${entry.order}: ${entry.title}`
    titleBlock(title, entry.practice ? `Practice problem: ${entry.practice.title}${entry.practice.source === 'ai' ? ' (AI-written)' : ''}` : subjectLine)
    if (!journal) detailsPanel([...studentPairs, ['Submitted', entry.submittedAt ? formatDate(entry.submittedAt, true) : 'Not submitted'], ['Report generated', formatDate(report.generatedAt, true)]])

    // Result summary line
    ensure(10)
    const w = pill(entry.status, PAGE.margin, y)
    const facts = [
      entry.score && `Sample tests ${entry.score.samplesPassed}/${entry.score.samplesTotal}`,
      entry.score?.hiddenTotal ? `Hidden tests ${entry.score.hiddenPassed}/${entry.score.hiddenTotal}` : '',
      entry.status !== 'locked' && `${entry.attempts} submission${entry.attempts === 1 ? '' : 's'}`,
      entry.solvedAt ? `Solved on ${formatDate(entry.solvedAt, true)}` : journal && entry.submittedAt && `Last submitted ${formatDate(entry.submittedAt, true)}`,
    ].filter(Boolean).join('   ·   ')
    font('normal', 8.5, MUTED)
    const factLines: string[] = facts ? doc.splitTextToSize(facts, CONTENT_W - w - 4) : []
    factLines.forEach((line, n) => doc.text(line, PAGE.margin + w + 3, y + 3.9 + n * lh(8.5) * 1.3))
    y += 9 + Math.max(0, factLines.length - 1) * lh(8.5) * 1.3

    if (!entry.problem) {
      write(entry.execution.note || 'This experiment is locked.', { color: MUTED })
      return
    }
    const { problem } = entry

    heading('Aim / Problem statement')
    write(problem.text, { gap: 2 })
    const block = (label: string, text: string, mono = false) => {
      if (!text.trim()) return
      ensure(12)
      write(label, { size: 8.5, style: 'bold', color: MUTED, gap: 0.6 })
      write(text, { family: mono ? 'DejaVuMono' : 'DejaVu', size: mono ? 9 : 10, gap: 2.2 })
    }
    block('Input format', problem.inputFormat)
    block('Output format', problem.outputFormat)
    block('Constraints', problem.constraints, true)

    if (problem.samples.length) {
      heading('Sample test cases')
      problem.samples.forEach((sample, i) => {
        ensure(16)
        write(`Example ${i + 1}`, { size: 9, style: 'bold', gap: 1 })
        codeBox(sample.input, { label: 'Input', size: 8.4 })
        codeBox(sample.output, { label: 'Expected output', size: 8.4 })
        if (sample.explanation) write(sample.explanation, { size: 8.8, color: MUTED, gap: 2 })
      })
    }

    if (entry.status === 'locked') {
      heading('Status')
      write(entry.execution.note || 'Locked: this experiment opens once the previous one is solved.', { color: MUTED, gap: 2 })
      signatures()
      return
    }

    heading('Program')
    if (entry.code) {
      write(`${languageLabel(entry.code.language)}${entry.code.draft ? '   ·   Draft from the editor (not submitted)' : entry.submittedAt ? `   ·   Submitted ${formatDate(entry.submittedAt, true)}` : ''}`, { size: 8.5, color: entry.code.draft ? STATUS.not_solved.color : MUTED, gap: 1.5 })
      codeBox(entry.code.text, { numbers: true })
    } else {
      write('No code was written or submitted for this experiment.', { color: MUTED, gap: 2 })
    }

    heading('Execution output')
    const { execution } = entry
    if (execution.compileError) {
      write('The program did not compile. Compiler message:', { size: 9, color: STATUS.compile_error.color, gap: 1.2 })
      codeBox(execution.compileError, { bg: STATUS.compile_error.bg, color: STATUS.compile_error.color, size: 8.2 })
    } else if (execution.results.length) {
      const passed = execution.results.filter(r => r.passed).length
      write(`${passed} of ${execution.results.length} sample test${execution.results.length === 1 ? '' : 's'} produced the expected output.`, { size: 9, color: MUTED, gap: 1.5 })
      execution.results.forEach(r => {
        ensure(22)
        font('bold', 9, INK)
        doc.text(`Test ${r.testCase}`, PAGE.margin, y + 3.6)
        pill(r.passed ? 'solved' : 'compile_error', PAGE.w - PAGE.margin, y, 'right', r.passed ? 'Passed' : 'Failed')
        y += 7.5
        codeBox(r.input, { label: 'Input', size: 8.2 })
        codeBox(r.actual || '(no output)', { label: 'Program output', size: 8.2, bg: r.passed ? CODE_BG : [253, 240, 240] })
        if (!r.passed) codeBox(r.expected, { label: 'Expected output', size: 8.2 })
        y += 1.5
      })
    } else {
      write(execution.note || 'No output.', { color: MUTED, gap: 2 })
    }

    heading('Result')
    const conclusion: Record<ReportStatus, string> = {
      solved: 'The program was executed successfully and produced the expected output for every sample test case.',
      not_solved: 'The program compiled and ran, but its output did not match the expected output for every sample test case.',
      compile_error: 'The latest submission did not compile, so the program could not be executed.',
      not_submitted: entry.code ? 'The program has not been submitted for evaluation yet; the code above is an unsubmitted draft.' : 'No program has been submitted for this experiment yet.',
      locked: '',
    }
    write(conclusion[entry.status], { gap: 2 })
    signatures()
  }

  if (journal) {
    // Cover: student details and an index of experiments
    titleBlock(subject.title, [subject.code, 'Practical journal'].filter(Boolean).join(' · '))
    detailsPanel([...studentPairs, ['Experiments solved', `${report.entries.filter(e => e.status === 'solved').length} of ${report.entries.length}`], ['Report generated', formatDate(report.generatedAt, true)]])
    heading('Index')
    const cols = [{ label: 'No.', w: 12 }, { label: 'Experiment', w: CONTENT_W - 12 - 34 - 38 - 22 }, { label: 'Status', w: 34 }, { label: 'Date', w: 38 }, { label: 'Sign', w: 22 }]
    const row = (cells: string[], header = false, status?: ReportStatus) => {
      font(header ? 'bold' : 'normal', header ? 8 : 9, header ? MUTED : INK)
      const title: string[] = doc.splitTextToSize(cells[1], cols[1].w - 3)
      const h = Math.max(7.5, title.length * lh(9) * 1.25 + 3.5)
      ensure(h)
      if (header) { doc.setFillColor(...PANEL); doc.rect(PAGE.margin, y, CONTENT_W, h, 'F') }
      let x = PAGE.margin
      cols.forEach((col, i) => {
        if (i === 2 && status) {
          font('bold', 8.5, STATUS[status].color)
          doc.text(STATUS[status].label, x + 2, y + 4.8)
          font('normal', 9, INK)
        } else if (i === 1) {
          title.forEach((line, n) => doc.text(line, x + 2, y + 4.8 + n * lh(9) * 1.25))
        } else doc.text(cells[i] ?? '', x + 2, y + 4.8)
        x += col.w
      })
      y += h
      doc.setDrawColor(...RULE)
      doc.setLineWidth(0.2)
      doc.line(PAGE.margin, y, PAGE.w - PAGE.margin, y)
    }
    row(cols.map(c => c.label), true)
    report.entries.forEach(e => row([String(e.order), e.title, '', e.solvedAt ? formatDate(e.solvedAt) : e.submittedAt ? formatDate(e.submittedAt) : '—', ''], false, e.status))
    if (!report.entries.length) write('This practical has no experiments yet.', { color: MUTED })
    report.entries.forEach(entry => { newPage(); experimentSection(entry) })
  } else {
    experimentSection(report.entries[0])
  }

  // Footer on every page
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.2)
    doc.line(PAGE.margin, PAGE.h - 12, PAGE.w - PAGE.margin, PAGE.h - 12)
    font('normal', 7.5, MUTED)
    doc.text(doc.splitTextToSize([student.name, subject.title].filter(Boolean).join('  ·  '), CONTENT_W / 2 - 20)[0], PAGE.margin, PAGE.h - 7)
    doc.text(`Page ${page} of ${pages}`, PAGE.w / 2, PAGE.h - 7, { align: 'center' })
    const brand = 'JEMS'
    font('bold', 7.5, ACCENT)
    const brandW = doc.getTextWidth(brand)
    doc.text(brand, PAGE.w - PAGE.margin, PAGE.h - 7, { align: 'right' })
    font('normal', 7.5, MUTED)
    doc.text('Powered by ', PAGE.w - PAGE.margin - brandW, PAGE.h - 7, { align: 'right' })
  }

  const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  const who = slug(student.rollNumber || student.name) || 'student'
  const what = journal ? `${slug(subject.code || subject.title)}-journal` : `${slug(subject.code || subject.title)}-exp-${report.entries[0]?.order ?? 0}${report.entries[0]?.practice ? '-practice' : ''}`
  return `${what}-${who}.pdf`
}

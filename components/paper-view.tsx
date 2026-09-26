'use client'

import { useState } from 'react'
import { Check, Download, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/form'
import { Dialog, useFeedback } from '@/components/ui/overlay'
import { errorMessage, letter, type BankQuestion } from '@/lib/api'
import { downloadPaperPdf, type PaperMeta } from '@/lib/paper-pdf'
import { cn } from '@/lib/utils'

/** Read-only question paper, laid out like the PDF, with an answers toggle and download buttons. */
export function PaperView({ open, onClose, meta, questions, loading }: { open: boolean; onClose: () => void; meta: PaperMeta; questions: BankQuestion[] | null; loading?: boolean }) {
  const [answers, setAnswers] = useState(false)
  const mcqs = (questions ?? []).filter(q => q.type !== 'coding')
  const coding = (questions ?? []).filter(q => q.type === 'coding')

  return (
    <Dialog open={open} onClose={onClose} size="xl" title={meta.title} description={questions ? `${mcqs.length} objective · ${coding.length} coding` : 'Loading questions…'}
      footer={<div className="flex w-full flex-wrap items-center justify-between gap-3">
        <Checkbox checked={answers} onChange={e => setAnswers(e.target.checked)} label={<span className="text-[13px]">Show answers and explanations</span>} />
        <PdfButtons meta={meta} questions={questions} />
      </div>}>
      {loading || !questions ? <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div> : (
        <article className="mx-auto max-w-3xl">
          <header className="border-b border-border pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">MGM&apos;s College of Engineering, Nanded</p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight">{meta.title}</h1>
            <p className="mt-1 text-xs text-muted-foreground">{[meta.code && `Room ${meta.code}`, meta.durationMinutes && `${meta.durationMinutes} minutes`, meta.marksPerQuestion != null && mcqs.length ? `${meta.marksPerQuestion} per MCQ${meta.negativeMarks ? `, −${meta.negativeMarks} wrong` : ''}` : ''].filter(Boolean).join(' · ')}</p>
          </header>
          {mcqs.length > 0 && <p className="mb-3 mt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Section A · Multiple choice</p>}
          <ol className="flex flex-col gap-5">
            {mcqs.map((q, i) => (
              <li key={q.id} className="flex gap-3">
                <span className="w-6 shrink-0 text-right font-semibold tabular-nums">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-6">{q.text}</p>
                  <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {q.options.map((option, j) => {
                      const correct = answers && j === q.correctIndex
                      return <li key={j} className={cn('flex gap-2 rounded-md px-2 py-1 text-sm', correct ? 'bg-success-soft font-medium text-success-ink' : 'text-foreground/90')}><span className="font-mono text-xs text-muted-foreground">({letter(j)})</span><span className="flex-1">{option}</span>{correct && <Check className="size-4" />}</li>
                    })}
                  </ul>
                  {answers && q.explanation && <p className="mt-1.5 text-xs leading-5 text-muted-foreground">Explanation: {q.explanation}</p>}
                </div>
              </li>
            ))}
          </ol>
          {coding.length > 0 && <p className="mb-3 mt-8 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Section {mcqs.length ? 'B' : 'A'} · Coding</p>}
          <div className="flex flex-col gap-6">
            {coding.map((q, i) => (
              <section key={q.id} className="rounded-lg border border-border p-4">
                <h3 className="font-semibold">P{i + 1}. {q.title || 'Coding problem'} {(q.points ?? meta.codingMarks) != null && <span className="text-sm font-normal text-muted-foreground">({q.points ?? meta.codingMarks} marks)</span>}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{q.text}</p>
                {[['Input format', q.inputFormat], ['Output format', q.outputFormat], ['Constraints', q.constraints]].filter(([, v]) => v?.trim()).map(([label, value]) => (
                  <div key={label} className="mt-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-0.5 whitespace-pre-wrap text-sm leading-6">{value}</p></div>
                ))}
                {q.samples.map((s, j) => (
                  <div key={j} className="mt-3 grid gap-2 sm:grid-cols-2">
                    <pre className="overflow-x-auto rounded-md bg-muted p-2.5 font-mono text-xs"><span className="mb-1 block font-sans text-[10px] font-semibold uppercase text-muted-foreground">Sample input {j + 1}</span>{s.input}</pre>
                    <pre className="overflow-x-auto rounded-md bg-muted p-2.5 font-mono text-xs"><span className="mb-1 block font-sans text-[10px] font-semibold uppercase text-muted-foreground">Sample output {j + 1}</span>{s.output}</pre>
                  </div>
                ))}
              </section>
            ))}
          </div>
          {questions.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No questions in this group.</p>}
        </article>
      )}
    </Dialog>
  )
}

/** "Question paper" and "With answers" PDF downloads. */
export function PdfButtons({ meta, questions, size = 'default', getQuestions }: { meta: PaperMeta; questions?: BankQuestion[] | null; size?: 'default' | 'sm' | 'xs'; getQuestions?: () => Promise<BankQuestion[]> }) {
  const { toast } = useFeedback()
  const [busy, setBusy] = useState<'paper' | 'answers' | null>(null)
  async function run(withAnswers: boolean) {
    setBusy(withAnswers ? 'answers' : 'paper')
    try {
      const list = questions ?? (await getQuestions?.()) ?? []
      if (!list.length) throw new Error('There are no questions to export.')
      await downloadPaperPdf(meta, list, { withAnswers })
      toast(withAnswers ? 'Paper with answers downloaded.' : 'Question paper downloaded.')
    } catch (err) { toast(errorMessage(err, 'Could not create the PDF.'), 'error') } finally { setBusy(null) }
  }
  return (
    <div className="flex gap-2">
      <Button variant="outline" size={size} disabled={busy !== null} onClick={() => run(true)}>{busy === 'answers' ? <Loader2 className="animate-spin" /> : <FileText />}With answers</Button>
      <Button size={size} disabled={busy !== null} onClick={() => run(false)}>{busy === 'paper' ? <Loader2 className="animate-spin" /> : <Download />}Download PDF</Button>
    </div>
  )
}

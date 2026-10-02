import type { Metadata } from 'next'
import Link from 'next/link'
import { COLLEGE_CITY, COLLEGE_NAME, COMPANY_NAME, PORTAL_NAME, SUPPORT_EMAIL } from '@/components/brand'
import { LegalPage, LegalSection } from '@/components/legal-page'

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: `How the ${PORTAL_NAME} website and the MGM Exam app collect, use and delete your information.`,
}

const UPDATED = '2 October 2026'

// Keep this in step with what the code actually does: the data in lib/models.ts, the services in lib/gemini.ts,
// lib/compiler.ts, lib/mail.ts, lib/imageuploader.ts and app/layout.tsx (analytics), and lib/account-deletion.ts.

const sections = [
  { id: 'collect', title: '1. Information we collect' },
  { id: 'use', title: '2. How we use it' },
  { id: 'services', title: '3. Services that process your information' },
  { id: 'sharing', title: '4. Who can see it' },
  { id: 'device', title: '5. Cookies and data on your device' },
  { id: 'retention', title: '6. How long we keep it' },
  { id: 'rights', title: '7. Your choices and rights' },
  { id: 'security', title: '8. Security' },
  { id: 'children', title: '9. Students under 18' },
  { id: 'changes', title: '10. Changes to this policy' },
  { id: 'contact', title: '11. Contact' },
]

/** /privacy-policy — public privacy policy for the website and the MGM Exam app. */
export default function PrivacyPolicyPage() {
  const contact = SUPPORT_EMAIL ? <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> : "your college's exam coordinator"
  return (
    <LegalPage title="Privacy policy" updated={UPDATED}
      intro={<>This policy explains what the <b className="font-semibold text-foreground">{COLLEGE_NAME}, {COLLEGE_CITY} {PORTAL_NAME}</b> (the website) and the <b className="font-semibold text-foreground">MGM Exam</b> app for Android and iPhone collect, why, and how you can delete it. The portal is run for the college and built by {COMPANY_NAME}. It is used by college faculty and students for online exams and lab practicals. We do not sell your information or show advertising.</>}>

      <nav aria-label="Contents" className="rounded-lg border border-border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contents</p>
        <ol className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
          {sections.map(s => <li key={s.id}><a href={`#${s.id}`} className="text-primary hover:underline">{s.title}</a></li>)}
        </ol>
      </nav>

      <LegalSection id="collect" title={sections[0].title}>
        <p><b>Faculty accounts:</b> name, email, department and a password (stored only as a secure hash).</p>
        <p><b>Student accounts:</b> college email (added by faculty), name, roll number, PRN, class (year, branch, division) and a password (stored only as a secure hash).</p>
        <p><b>Exams:</b> the questions on your paper, your answers and code, timing, marks and results. To keep exams fair, we also record exam-integrity signals while you write: leaving the exam tab or window, leaving fullscreen, blocked copy, paste, right-click, print or developer-tool shortcuts, opening the exam on a second device, and a change of network. With each attempt we store the IP addresses it was taken from and the browser or device description.</p>
        <p><b>Practicals:</b> the code you submit for each experiment and practice problem, its test results, and AI practice problems written for you.</p>
        <p><b>Material faculty provide:</b> questions, experiments, and documents or notes uploaded so the AI can write questions from them. Uploaded files are kept only until that generation finishes.</p>
        <p><b>Messages:</b> one-time codes and the emails we send you (see below).</p>
        <p>We don&apos;t collect your location, contacts, photos (other than images faculty choose to attach to questions) or payment information. The app doesn&apos;t use your camera or microphone.</p>
      </LegalSection>

      <LegalSection id="use" title={sections[1].title}>
        <ul>
          <li>To sign you in and keep your account secure, including one-time codes to activate an account or reset a password.</li>
          <li>To run exams and practicals: deal papers, save answers, run and grade code, unlock experiments, and show results and analysis.</li>
          <li>To help faculty supervise exams fairly, using the integrity signals above.</li>
          <li>To email you about your account and your work: sign-in codes, exam schedules and reminders, submissions received, results, and AI work finished in the background.</li>
          <li>To produce PDFs you ask for, such as a practical journal.</li>
          <li>To keep the service working: preventing abuse with request limits and fixing problems.</li>
        </ul>
        <p>We don&apos;t use your information for advertising, profiling or any purpose unrelated to your studies or teaching.</p>
      </LegalSection>

      <LegalSection id="services" title={sections[2].title}>
        <p>Some work is done by trusted service providers, who receive only what that work needs:</p>
        <ul>
          <li><b>Google Gemini (AI):</b> writes questions and lab problems. It receives the topics, instructions and documents faculty provide, and the practical&apos;s subject and experiment titles. It does not receive students&apos; names, emails, answers or results.</li>
          <li><b>Code execution service:</b> runs submitted code against test inputs and returns the output. It receives the code and the inputs, not who wrote them.</li>
          <li><b>Email provider:</b> delivers our emails to your address.</li>
          <li><b>Image hosting (Cloudinary):</b> stores images faculty attach to questions.</li>
          <li><b>Database and website hosting:</b> stores the information described here and serves the website.</li>
          <li><b>Vercel Web Analytics (website only):</b> counts page visits without cookies and without identifying you.</li>
        </ul>
      </LegalSection>

      <LegalSection id="sharing" title={sections[3].title}>
        <ul>
          <li><b>Faculty</b> see their students&apos; profiles, answers, code, marks, results and integrity signals for their own exams and practicals.</li>
          <li><b>Students</b> see their own work and results. Leaderboards, when a faculty member shows them, include names and scores of students in that exam.</li>
          <li>We don&apos;t sell or rent your information, and share it with no one else except when the law requires it.</li>
        </ul>
      </LegalSection>

      <LegalSection id="device" title={sections[4].title}>
        <ul>
          <li><b>Website:</b> one secure sign-in cookie per account type, needed to keep you signed in. Your theme choice and unsent code drafts are kept in your browser. No advertising or tracking cookies.</li>
          <li><b>App:</b> your sign-in token is kept in the phone&apos;s secure storage; your theme and notification preferences on the phone. Notifications (exam reminders, admissions, finished AI work) are created by the app on your phone; we don&apos;t collect a push-notification ID. PDFs you open are saved temporarily in the app&apos;s own storage.</li>
        </ul>
      </LegalSection>

      <LegalSection id="retention" title={sections[5].title}>
        <ul>
          <li>Your account and work are kept while your account exists, so you and your faculty can see past results.</li>
          <li>One-time codes expire after 10 minutes. Request counters expire within an hour.</li>
          <li>Results of running code are cached for 7 days, without your name, so the same run isn&apos;t repeated.</li>
          <li>AI question generations and background AI jobs are kept for up to 30 days; documents uploaded for them are deleted as soon as they finish.</li>
          <li>When an account is deleted, everything above that belongs to it is removed immediately (see <Link href="/delete-account">Delete your account</Link>).</li>
        </ul>
      </LegalSection>

      <LegalSection id="rights" title={sections[6].title}>
        <ul>
          <li><b>See and correct:</b> view your information in the website or the app, and edit your profile there. Faculty can correct a student&apos;s class details.</li>
          <li><b>Delete:</b> delete your account and all its data yourself, at any time: in the app (Profile → Delete account), on the website, or on the <Link href="/delete-account">account deletion page</Link> without signing in.</li>
          <li><b>Notifications:</b> turn the app&apos;s notifications on or off in its Profile screen or in your phone settings.</li>
          <li><b>Questions or other requests:</b> contact {contact}.</li>
        </ul>
      </LegalSection>

      <LegalSection id="security" title={sections[7].title}>
        <p>Passwords are stored only as secure hashes and never in readable form. Information travels over encrypted connections (HTTPS). Sign-ins are protected by signed, expiring tokens, and sign-in attempts and other requests are rate-limited. Faculty can see only their own exams and practicals; students only their own work. No system is perfectly secure, but we work to protect your information and fix problems quickly.</p>
      </LegalSection>

      <LegalSection id="children" title={sections[8].title}>
        <p>The portal is for college faculty and students and is not directed at children under 13. Some students may be under 18; their accounts are created at the college&apos;s request for coursework, and the same protections and deletion options apply to them.</p>
      </LegalSection>

      <LegalSection id="changes" title={sections[9].title}>
        <p>If we change how we handle your information, we&apos;ll update this page and its date. Important changes will also be announced in the portal or by email.</p>
      </LegalSection>

      <LegalSection id="contact" title={sections[10].title}>
        <p>For any question about your information or this policy, contact {contact}.</p>
        <p>{COLLEGE_NAME}, {COLLEGE_CITY}.</p>
      </LegalSection>
    </LegalPage>
  )
}

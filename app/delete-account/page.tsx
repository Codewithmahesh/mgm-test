import type { Metadata } from 'next'
import Link from 'next/link'
import { COLLEGE_NAME, PORTAL_NAME, SUPPORT_EMAIL } from '@/components/brand'
import { LegalPage, LegalSection } from '@/components/legal-page'
import { DeleteAccountForm } from './form'

export const metadata: Metadata = {
  title: 'Delete your account',
  description: `How to permanently delete your ${PORTAL_NAME} account (website and MGM Exam app) and what is deleted.`,
}

const UPDATED = '2 October 2026'

/**
 * /delete-account — public page (no sign-in, no app needed) for deleting a faculty or student account of the
 * website and the MGM Exam app, as app stores require. The form posts to /api/account/delete.
 */
export default function DeleteAccountPage() {
  return (
    <LegalPage title="Delete your account" updated={UPDATED}
      intro={<>This page applies to the <b className="font-semibold text-foreground">{COLLEGE_NAME} {PORTAL_NAME}</b> website and the <b className="font-semibold text-foreground">MGM Exam</b> app for Android and iPhone, which share one account. Faculty and students can delete their account and everything in it at any time. Deletion is permanent and happens immediately.</>}>

      <LegalSection title="Delete it here">
        <p>Enter the email and password you sign in with. You don&apos;t need to sign in to the website or install the app.</p>
        <DeleteAccountForm />
      </LegalSection>

      <LegalSection title="Or delete it from your account">
        <ul>
          <li><b>In the MGM Exam app:</b> open <b>Profile</b>, scroll to <b>Delete account</b> and tap <b>Delete my account</b>.</li>
          <li><b>On the website:</b> faculty open the menu under their name, then <b>Profile</b> (<Link href="/teacher/account">Account</Link>); students open <Link href="/student/profile">Profile</Link>. Then choose <b>Delete my account</b>.</li>
        </ul>
        <p>Every way asks for your password and for you to type <b className="font-mono">DELETE</b>, so an account can&apos;t be deleted by mistake. We email you once it&apos;s done.</p>
        <p>Forgot your password? Reset it from the <Link href="/teacher/forgot-password">faculty</Link> or <Link href="/student/forgot-password">student</Link> sign-in page first.</p>
      </LegalSection>

      <LegalSection title="What is deleted">
        <p><b>Student accounts:</b></p>
        <ul>
          <li>Your profile: name, college email, roll number, PRN, class and password.</li>
          <li>Your exam attempts: answers, code, marks, results and the exam-integrity signals recorded during them (such as tab switches), with the IP addresses and browser details saved with them.</li>
          <li>Your requests to join exams.</li>
          <li>Your practical submissions and the AI practice problems written for you.</li>
        </ul>
        <p><b>Faculty accounts:</b></p>
        <ul>
          <li>Your profile: name, email, department and password.</li>
          <li>Your exam rooms, with every student&apos;s attempt, answers and results in them, and their join requests.</li>
          <li>Your question bank and AI question generations.</li>
          <li>Your practicals: experiments, practice problems, students&apos; submissions in them and background AI jobs.</li>
        </ul>
        <p>For both: one-time sign-in codes and request counters linked to your account.</p>
      </LegalSection>

      <LegalSection title="What is kept">
        <ul>
          <li><b>Nothing in our database.</b> Everything listed above is removed immediately, not after a waiting period.</li>
          <li>Student accounts added by a faculty member stay when that faculty account is deleted: they belong to the students, who can delete them here.</li>
          <li>Images faculty attached to questions are stored with our image host and may remain there.</li>
          <li>Emails we already sent you (results, reminders) stay in your inbox.</li>
          <li>The app may keep display preferences (such as dark mode) on your phone until you uninstall it.</li>
        </ul>
        <p>See our <Link href="/privacy-policy">privacy policy</Link> for what we collect and why.</p>
      </LegalSection>

      <LegalSection title="Need help?">
        <p>
          {SUPPORT_EMAIL
            ? <>Write to <a href={`mailto:${SUPPORT_EMAIL}?subject=Account%20deletion`}>{SUPPORT_EMAIL}</a> from the email on your account and we&apos;ll delete it for you.</>
            : <>Contact your college&apos;s exam coordinator, who can have your account deleted for you.</>}
        </p>
      </LegalSection>
    </LegalPage>
  )
}

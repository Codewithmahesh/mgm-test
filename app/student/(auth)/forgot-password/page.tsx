import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'
import { OtpFlow } from '@/components/otp-flow'

export const metadata = { title: 'Reset student password' }

export default function StudentForgotPasswordPage() {
  return (
    <AuthShell role="Student" title="Reset your password" subtitle="We'll send a verification code to your college email." footer={<Link href="/student/login" className="font-medium text-primary hover:underline">← Back to sign in</Link>}>
      <OtpFlow purpose="reset" />
    </AuthShell>
  )
}

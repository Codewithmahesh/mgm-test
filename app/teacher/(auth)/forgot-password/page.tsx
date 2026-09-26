import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'
import { OtpFlow } from '@/components/otp-flow'

export const metadata = { title: 'Reset faculty password' }

export default function TeacherForgotPasswordPage() {
  return (
    <AuthShell role="Faculty" title="Reset your password" subtitle="We'll email a 6-digit verification code to your account." footer={<Link href="/teacher/login" className="font-medium text-primary hover:underline">← Back to sign in</Link>}>
      <OtpFlow purpose="reset" account="teacher" />
    </AuthShell>
  )
}

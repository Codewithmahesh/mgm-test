import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'
import { OtpFlow } from '@/components/otp-flow'

export const metadata = { title: 'Activate student account' }

export default function ActivatePage() {
  return (
    <AuthShell role="Student" title="Activate your account" subtitle="First time here? Verify your college email and set a password." footer={<>Already activated? <Link href="/student/login" className="font-medium text-primary hover:underline">Sign in</Link></>}>
      <OtpFlow purpose="activate" />
    </AuthShell>
  )
}

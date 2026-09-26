import { redirect } from 'next/navigation'

// Password resets now use an emailed OTP; older reset links land on the new flow.
export default function TeacherResetPasswordPage() {
  redirect('/teacher/forgot-password')
}

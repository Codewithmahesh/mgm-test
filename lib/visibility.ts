// Shared by exam submission and the result emails (kept separate so they don't import each other).

/** Whether a student may see their score yet, per the room's result setting. */
export function resultsVisible(
  room: { showResults?: string | null; status?: string | null },
  attempt: { status: string; autoSubmitted?: boolean; autoSubmitReason?: string }
) {
  if (attempt.status !== 'submitted') return false
  // If the student was suspended/auto-submitted due to violations or terminated by faculty, do not show results
  if (attempt.autoSubmitted && (attempt.autoSubmitReason === 'violations' || attempt.autoSubmitReason === 'faculty')) {
    return false
  }
  if (room.showResults === 'after_submit') return true
  if (room.showResults === 'never') return false
  return room.status === 'closed'
}

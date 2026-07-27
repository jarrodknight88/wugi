// One key per check-in attempt (generated once, reused across manual
// retries of that same attempt) so a re-sent checkInPass call can't
// double-write — see the idempotencyKey handling in
// functions/src/door/checkInPass.ts.
export function generateIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

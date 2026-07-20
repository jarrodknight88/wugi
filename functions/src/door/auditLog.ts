// ─────────────────────────────────────────────────────────────────────
// Wugi — Door security audit log
// Records every refund/void attempt — allowed or denied — independent
// of terminalRefunds/terminalVoids, which only exist for successful
// actions. Lets a Manager/Super Admin see who touched Stripe money and
// who was blocked from doing so.
// ─────────────────────────────────────────────────────────────────────
import * as admin from 'firebase-admin';

export interface DoorSecurityEvent {
  action: 'refund' | 'void';
  result: 'allowed' | 'denied';
  denyReason?: string;
  paymentIntentId: string;
  staffUid: string;
  staffRole?: string;
  staffIdentity?: string;
  ip?: string;
}

export async function logDoorSecurityEvent(event: DoorSecurityEvent): Promise<void> {
  try {
    await admin.firestore().collection('doorSecurityAuditLog').add({
      ...event,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Audit logging must never block or fail the caller's request
    console.error('Failed to write door security audit log:', err);
  }
}

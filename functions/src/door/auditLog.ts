// ─────────────────────────────────────────────────────────────────────
// Wugi — Door security audit log
// Records every refund/void/capture attempt — allowed or denied —
// independent of terminalRefunds/terminalVoids/terminalPayments, which only
// exist for successful actions. Lets a Manager/Super Admin see who touched
// Stripe money and who was blocked from doing so.
// ─────────────────────────────────────────────────────────────────────
import * as admin from 'firebase-admin';

export interface DoorSecurityEvent {
  action: 'refund' | 'void' | 'capture';
  result: 'allowed' | 'denied';
  denyReason?: string;
  paymentIntentId: string;
  staffUid: string;
  staffRole?: string;
  staffIdentity?: string;
  ip?: string;
  // 'capture'-only fields — records exactly what was captured against a ticket's balance
  amountCents?: number;
  ticketId?: string;
  previousBalanceDue?: number;
  newBalanceDue?: number;
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

import { FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"

// Server-side counterpart to lib/auditLog.ts's logAudit(). auditLogs is
// Cloud-Functions/admin-write-only per firestore.rules, so mutations made
// through these Admin SDK-backed venueIntel routes log here instead of via
// the client-side helper.
export async function logAuditServer(params: {
  adminId: string
  adminEmail: string
  action: string
  targetId: string
  targetName: string
}) {
  await adminDb.collection("auditLogs").add({
    ...params,
    timestamp: FieldValue.serverTimestamp(),
  })
}

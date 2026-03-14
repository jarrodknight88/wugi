import { addDoc, collection, serverTimestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"

export async function logAudit(params: {
  adminId: string
  adminEmail: string
  action: string
  targetId: string
  targetName: string
}) {
  await addDoc(collection(db, "auditLogs"), {
    ...params,
    timestamp: serverTimestamp(),
  })
}

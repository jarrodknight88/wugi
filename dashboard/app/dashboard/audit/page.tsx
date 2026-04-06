"use client"
import DashboardLayout from "@/components/DashboardLayout"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuthContext } from "@/context/AuthContext"

type AuditEntry = { id: string; adminEmail: string; action: string; targetName: string; timestamp: string }

export default function AuditLogsPage() {
  const router = useRouter()
  const { user, hasDashboardAccess, loading } = useAuthContext()
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [loadingLogs, setLoadingLogs] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
    if (!hasDashboardAccess) router.replace("/unauthorized")
  }, [loading, user, hasDashboardAccess, router])

  useEffect(() => {
    if (!user) return
    setLoadingLogs(true)
    const q = query(collection(db, "auditLogs"), orderBy("timestamp", "desc"), limit(100))
    const unsub = onSnapshot(q, snap => {
      setLogs(snap.docs.map(d => {
        const data = d.data()
        let timestamp = "—"
        if (data.timestamp?.toDate) timestamp = data.timestamp.toDate().toLocaleString()
        else if (typeof data.timestamp === "string") timestamp = data.timestamp
        return { id: d.id, adminEmail: data.adminEmail || "—", action: data.action || "—", targetName: data.targetName || "—", timestamp }
      }))
      setLoadingLogs(false)
    }, () => { setError("Could not load audit logs."); setLoadingLogs(false) })
    return unsub
  }, [user])

  if (loading || !user || !hasDashboardAccess) return null

  const CARD = { background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" }

  return (
    <DashboardLayout>
      <div className="dash-page">
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0 }}>Audit Log</h1>
          <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>Last 100 admin actions.</p>
        </div>
        {error && <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13, marginBottom: 16 }}>{error}</div>}
        <div className="dash-table-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 600 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                {["Date/Time","Admin","Action","Target"].map(h => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 13 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingLogs ? (
                <tr><td colSpan={4} style={{ padding: "40px 16px", textAlign: "center", color: "#9ca3af" }}>Loading...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: "40px 16px", textAlign: "center", color: "#9ca3af" }}>No audit logs yet.</td></tr>
              ) : logs.map((entry, i) => (
                <tr key={entry.id} style={{ borderBottom: i < logs.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                  <td style={{ padding: "11px 16px", color: "#9ca3af", fontSize: 13, whiteSpace: "nowrap" }}>{entry.timestamp}</td>
                  <td style={{ padding: "11px 16px", color: "#374151" }}>{entry.adminEmail}</td>
                  <td style={{ padding: "11px 16px" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: "#f0fdf4", color: "#15803d" }}>{entry.action.replace(/_/g, " ")}</span>
                  </td>
                  <td style={{ padding: "11px 16px", color: "#6b7280" }}>{entry.targetName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  )
}

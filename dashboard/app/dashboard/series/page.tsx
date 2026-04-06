"use client"
import DashboardLayout from "@/components/DashboardLayout"
import { useAuthContext } from "@/context/AuthContext"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

export default function SeriesPage() {
  const { user, loading, hasDashboardAccess } = useAuthContext()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
  }, [loading, user, router])

  if (loading || !user || !hasDashboardAccess) return null

  return (
    <DashboardLayout>
      <div className="dash-page">
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0 }}>Event Series</h1>
          <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>Recurring event management — coming soon</p>
        </div>
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: 48, textAlign: "center" as const }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔄</div>
          <p style={{ fontSize: 15, fontWeight: 600, color: "#374151", margin: "0 0 8px" }}>Event Series</p>
          <p style={{ fontSize: 14, color: "#9ca3af", margin: 0, maxWidth: 360, marginLeft: "auto", marginRight: "auto" }}>
            Set up recurring weekly events like Fridayz ATL. The system will auto-generate individual event instances on your schedule.
          </p>
        </div>
      </div>
    </DashboardLayout>
  )
}

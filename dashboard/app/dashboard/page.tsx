"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { collection, onSnapshot, query, where, orderBy, limit } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuthContext } from "@/context/AuthContext"
import DashboardLayout from "@/components/DashboardLayout"
import Link from "next/link"

const CARD = {
  background: "#fff", borderRadius: 12, padding: "20px 24px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb",
}

function StatCard({ label, value, sub, accent }: { label: string; value: number | string; sub?: string; accent?: string }) {
  return (
    <div style={{ ...CARD }}>
      <div style={{ fontSize: 13, color: "#6b7280", fontWeight: 500, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 700, color: accent || "#111827", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const { user, hasDashboardAccess, hasUserDocument, loading: authLoading } = useAuthContext()
  const [stats, setStats] = useState({ venues: 0, pendingVenues: 0, events: 0, pendingEvents: 0, galleries: 0, photos: 0 })
  const [recentAudit, setRecentAudit] = useState<any[]>([])

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login")
    if (!authLoading && hasUserDocument && !hasDashboardAccess) router.replace("/unauthorized")
  }, [authLoading, user, hasDashboardAccess, hasUserDocument, router])

  useEffect(() => {
    if (!user) return
    const unsubs = [
      onSnapshot(collection(db, "venues"), s => {
        setStats(p => ({ ...p, venues: s.size, pendingVenues: s.docs.filter(d => d.data().status === "pending_review").length }))
      }),
      onSnapshot(collection(db, "events"), s => {
        setStats(p => ({ ...p, events: s.size, pendingEvents: s.docs.filter(d => d.data().status === "pending").length }))
      }),
      onSnapshot(collection(db, "eventGalleries"), s => {
        const photos = s.docs.reduce((acc, d) => acc + (d.data().photoCount || 0), 0)
        setStats(p => ({ ...p, galleries: s.size, photos }))
      }),
      onSnapshot(query(collection(db, "auditLogs"), orderBy("createdAt", "desc"), limit(6)), s => {
        setRecentAudit(s.docs.map(d => ({ id: d.id, ...d.data() })))
      }),
    ]
    return () => unsubs.forEach(u => u())
  }, [user])

  if (authLoading || !user || !hasDashboardAccess) return null

  return (
    <DashboardLayout>
      <div style={{ padding: "32px 36px" }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827", margin: 0 }}>Overview</h1>
          <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>Welcome back — here's what's happening with Wugi.</p>
        </div>

        {/* Quick actions */}
        <div style={{ display: "flex", gap: 10, marginBottom: 28, flexWrap: "wrap" }}>
          {[
            { label: "+ Add Venue", href: "/dashboard/venues?new=1", color: "#2a7a5a" },
            { label: "+ Add Event", href: "/dashboard/events?new=1", color: "#1d4ed8" },
            { label: "Review Queue", href: "/dashboard/venues", color: "#7c3aed" },
          ].map(btn => (
            <Link key={btn.href} href={btn.href} style={{
              padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: btn.color, color: "#fff", textDecoration: "none",
            }}>{btn.label}</Link>
          ))}
        </div>

        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 28 }}>
          <StatCard label="Total Venues" value={stats.venues} sub={`${stats.pendingVenues} need review`} accent="#111827"/>
          <StatCard label="Pending Venues" value={stats.pendingVenues} accent={stats.pendingVenues > 0 ? "#f59e0b" : "#10b981"}/>
          <StatCard label="Total Events" value={stats.events} sub={`${stats.pendingEvents} pending`}/>
          <StatCard label="Pending Events" value={stats.pendingEvents} accent={stats.pendingEvents > 0 ? "#f59e0b" : "#10b981"}/>
          <StatCard label="Galleries" value={stats.galleries} sub={`${stats.photos} photos`}/>
        </div>

        {/* Recent audit log */}
        <div style={{ ...CARD }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: "#111827", margin: 0 }}>Recent Activity</h2>
            <Link href="/dashboard/audit" style={{ fontSize: 13, color: "#2a7a5a", textDecoration: "none", fontWeight: 500 }}>View all →</Link>
          </div>
          {recentAudit.length === 0 ? (
            <p style={{ fontSize: 14, color: "#9ca3af" }}>No activity yet</p>
          ) : recentAudit.map(log => (
            <div key={log.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>
              <span style={{ color: "#374151" }}>
                <span style={{ fontWeight: 600, color: "#111827" }}>{log.adminEmail?.split("@")[0]}</span>
                {" "}{log.action?.replace(/_/g, " ")}{" "}
                <span style={{ color: "#6b7280" }}>{log.targetName}</span>
              </span>
              <span style={{ color: "#9ca3af", whiteSpace: "nowrap", marginLeft: 12 }}>
                {log.createdAt?.toDate?.()?.toLocaleDateString?.() || ""}
              </span>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  )
}

"use client"
import DashboardLayout from "@/components/DashboardLayout"
import { useAuthContext } from "@/context/AuthContext"
import { useEffect, useState } from "react"
import { collection, collectionGroup, onSnapshot } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useRouter } from "next/navigation"

const CARD = { background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" }
type Order = { id: string; buyerEmail: string; eventId: string; total: number; status: string; createdAt: any }

export default function TicketsPage() {
  const { user, loading } = useAuthContext()
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [loading, user, router])

  useEffect(() => {
    if (!user) return
    return onSnapshot(collection(db, "orders"), s => {
      const raw = s.docs.map(d => ({ id: d.id, buyerEmail: d.data().buyerEmail || "", eventId: d.data().eventId || "", total: d.data().total || 0, status: d.data().status || "confirmed", createdAt: d.data().createdAt }))
      raw.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
      setOrders(raw)
    })
  }, [user])

  if (loading || !user) return null

  const revenue = orders.filter(o => o.status === "confirmed").reduce((sum, o) => sum + o.total, 0)

  return (
    <DashboardLayout>
      <div className="dash-page">
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0 }}>Tickets</h1>
          <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>{orders.length} orders · ${(revenue / 100).toFixed(2)} total revenue</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 24 }}>
          {[
            { label: "Total Orders",   value: orders.length },
            { label: "Confirmed",      value: orders.filter(o => o.status === "confirmed").length },
            { label: "Disputed",       value: orders.filter(o => o.status === "disputed").length },
            { label: "Total Revenue",  value: "$" + (revenue / 100).toFixed(2) },
          ].map(c => (
            <div key={c.label} style={{ ...CARD, padding: "18px 20px" }}>
              <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 500, marginBottom: 6 }}>{c.label}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#111827" }}>{c.value}</div>
            </div>
          ))}
        </div>
        <div className="dash-table-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 600 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                {["Buyer","Event","Total","Status","Date"].map(h => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 13 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: "40px 16px", textAlign: "center", color: "#9ca3af" }}>No orders yet</td></tr>
              ) : orders.map((o, i) => (
                <tr key={o.id} style={{ borderBottom: i < orders.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                  <td style={{ padding: "12px 16px", color: "#111827" }}>{o.buyerEmail}</td>
                  <td style={{ padding: "12px 16px", color: "#6b7280", fontSize: 12 }}>{o.eventId}</td>
                  <td style={{ padding: "12px 16px", fontWeight: 600 }}>${(o.total / 100).toFixed(2)}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: o.status === "confirmed" ? "#dcfce7" : o.status === "disputed" ? "#fee2e2" : "#f3f4f6", color: o.status === "confirmed" ? "#15803d" : o.status === "disputed" ? "#b91c1c" : "#6b7280" }}>{o.status}</span>
                  </td>
                  <td style={{ padding: "12px 16px", color: "#9ca3af", fontSize: 13 }}>{o.createdAt?.toDate?.()?.toLocaleDateString?.() || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  )
}

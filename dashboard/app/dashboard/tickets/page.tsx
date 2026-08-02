"use client"
import DashboardLayout from "@/components/DashboardLayout"
import SearchSelect from "@/components/SearchSelect"
import { useAuthContext } from "@/context/AuthContext"
import { useEffect, useMemo, useState } from "react"
import { collection, onSnapshot } from "firebase/firestore"
import { getFunctions, httpsCallable } from "firebase/functions"
import { db } from "@/lib/firebase"
import { useRouter } from "next/navigation"
import { logAudit } from "@/lib/auditLog"

const CARD = { background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" }
const INPUT = { padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" as const }

type Order = { id: string; buyerName: string; buyerEmail: string; eventId: string; total: number; status: string; createdAt: any }
type EventInfo = { id: string; title: string; venue: string }
type CheckInInfo = { scanned: number; total: number }

// Mirrors functions/src/orders/refundTicketOrder.ts REFUNDABLE_STATUSES —
// keep in sync if that list changes.
const REFUNDABLE_STATUSES = ["confirmed", "disputed"]

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  confirmed: { bg: "#dcfce7", color: "#15803d" },
  disputed:  { bg: "#fee2e2", color: "#b91c1c" },
  cancelled: { bg: "#f3f4f6", color: "#6b7280" },
  refunded:  { bg: "#e0e7ff", color: "#3730a3" },
}

export default function TicketsPage() {
  const { user, loading, role } = useAuthContext()
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [events, setEvents] = useState<Record<string, EventInfo>>({})
  const [checkedIn, setCheckedIn] = useState<Record<string, CheckInInfo>>({})
  const [search, setSearch] = useState("")
  const [eventFilter, setEventFilter] = useState("")

  const [refundTarget, setRefundTarget] = useState<Order | null>(null)
  const [refundNote, setRefundNote] = useState("")
  const [refunding, setRefunding] = useState(false)
  const [refundError, setRefundError] = useState("")

  // Refunds move real money — restricted to the two full-admin tiers.
  // support/venue_admin/event_admin can otherwise see this page but not
  // issue a refund (see PR description for rationale). Enforced again
  // server-side in refundTicketOrder — this is UI affordance only.
  const canRefund = role === "super_admin" || role === "moderator"

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [loading, user, router])

  useEffect(() => {
    if (!user) return
    const u1 = onSnapshot(collection(db, "orders"), s => {
      const raw = s.docs.map(d => ({
        id: d.id,
        buyerName: d.data().buyerName || "",
        buyerEmail: d.data().buyerEmail || "",
        eventId: d.data().eventId || "",
        total: d.data().total || 0,
        status: d.data().status || "confirmed",
        createdAt: d.data().createdAt,
      }))
      raw.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
      setOrders(raw)
    })
    const u2 = onSnapshot(collection(db, "events"), s => {
      const map: Record<string, EventInfo> = {}
      s.docs.forEach(d => { map[d.id] = { id: d.id, title: d.data().title || "Untitled", venue: d.data().venue || "" } })
      setEvents(map)
    })
    // passes carries per-ticket scanStatus ('valid' | 'scanned' | 'refunded')
    // — used here only to show whether an order's tickets were checked in.
    const u3 = onSnapshot(collection(db, "passes"), s => {
      const map: Record<string, CheckInInfo> = {}
      s.docs.forEach(d => {
        const orderId = d.data().orderId
        if (!orderId) return
        if (!map[orderId]) map[orderId] = { scanned: 0, total: 0 }
        map[orderId].total += 1
        if (d.data().scanStatus === "scanned") map[orderId].scanned += 1
      })
      setCheckedIn(map)
    })
    return () => { u1(); u2(); u3() }
  }, [user])

  const eventOptions = useMemo(() =>
    Object.values(events)
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(e => ({ id: e.id, label: e.title, sub: e.venue })),
  [events])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orders.filter(o => {
      if (eventFilter && o.eventId !== eventFilter) return false
      if (!q) return true
      return o.buyerEmail.toLowerCase().includes(q) || o.buyerName.toLowerCase().includes(q)
    })
  }, [orders, search, eventFilter])

  function openRefund(order: Order) {
    setRefundTarget(order)
    setRefundNote("")
    setRefundError("")
  }

  async function submitRefund() {
    if (!refundTarget || !user) return
    setRefunding(true)
    setRefundError("")
    try {
      const fn = httpsCallable(getFunctions(), "refundTicketOrder")
      await fn({ orderId: refundTarget.id, staffNote: refundNote || undefined })
      await logAudit({
        adminId: user.uid, adminEmail: user.email || "",
        action: "refunded_ticket_order", targetId: refundTarget.id,
        targetName: refundTarget.buyerEmail || refundTarget.buyerName || refundTarget.id,
      })
      setRefundTarget(null)
    } catch (e: any) {
      // Staff-facing — surface the server error verbatim, no friendly-vague message.
      setRefundError(e?.message || String(e))
    } finally {
      setRefunding(false)
    }
  }

  if (loading || !user) return null

  const revenue = orders.filter(o => o.status === "confirmed").reduce((sum, o) => sum + o.total, 0)
  const refundCheckIn = refundTarget ? checkedIn[refundTarget.id] : undefined

  return (
    <DashboardLayout>
      <div className="dash-page">
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0 }}>Tickets</h1>
          <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>{orders.length} orders · ${(revenue / 100).toFixed(2)} total revenue</p>
        </div>

        <div className="dash-stat-grid">
          {[
            { label: "Total Orders",  value: orders.length },
            { label: "Confirmed",     value: orders.filter(o => o.status === "confirmed").length },
            { label: "Disputed",      value: orders.filter(o => o.status === "disputed").length },
            { label: "Refunded",      value: orders.filter(o => o.status === "refunded").length },
            { label: "Total Revenue", value: "$" + (revenue / 100).toFixed(2) },
          ].map(c => (
            <div key={c.label} style={{ ...CARD, padding: "18px 20px" }}>
              <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 500, marginBottom: 6 }}>{c.label}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#111827" }}>{c.value}</div>
            </div>
          ))}
        </div>

        <div className="dash-filters">
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by purchaser name or email..."
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, width: 260, outline: "none" }}
          />
          <div style={{ width: 260 }}>
            <SearchSelect
              options={eventOptions}
              value={eventFilter}
              onChange={id => setEventFilter(id)}
              placeholder="Filter by event..."
            />
          </div>
        </div>

        <div className="dash-table-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 760 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                {["Buyer", "Event", "Total", "Status", "Checked In", "Date", "Actions"].map(h => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 13 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: "40px 16px", textAlign: "center", color: "#9ca3af" }}>No orders found</td></tr>
              ) : filtered.map((o, i) => {
                const ev = events[o.eventId]
                const ci = checkedIn[o.id]
                const st = STATUS_STYLE[o.status] || { bg: "#f3f4f6", color: "#6b7280" }
                const refundable = REFUNDABLE_STATUSES.includes(o.status)
                return (
                  <tr key={o.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                    <td style={{ padding: "12px 16px", color: "#111827" }}>
                      <div style={{ fontWeight: 600 }}>{o.buyerName || "—"}</div>
                      <div style={{ fontSize: 12, color: "#6b7280" }}>{o.buyerEmail}</div>
                    </td>
                    <td style={{ padding: "12px 16px", color: "#374151", fontSize: 13 }}>
                      <div>{ev?.title || o.eventId}</div>
                      {ev?.venue && <div style={{ fontSize: 12, color: "#9ca3af" }}>{ev.venue}</div>}
                    </td>
                    <td style={{ padding: "12px 16px", fontWeight: 600 }}>${(o.total / 100).toFixed(2)}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: st.bg, color: st.color }}>{o.status}</span>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "#6b7280" }}>
                      {ci ? `${ci.scanned} / ${ci.total}` : "—"}
                    </td>
                    <td style={{ padding: "12px 16px", color: "#9ca3af", fontSize: 13 }}>{o.createdAt?.toDate?.()?.toLocaleDateString?.() || "—"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      {canRefund && refundable && (
                        <button
                          onClick={() => openRefund(o)}
                          style={{ padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: "#fee2e2", color: "#b91c1c" }}
                        >
                          Refund
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 12 }}>
          Partial and bulk refunds aren&apos;t supported here — for those, use the Stripe Dashboard.
        </p>
      </div>

      {refundTarget && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => !refunding && setRefundTarget(null)}
        >
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "24px 28px", borderBottom: "1px solid #f3f4f6" }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Refund Ticket</h2>
            </div>
            <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
              {refundError && (
                <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
                  {refundError}
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <DetailRow label="Amount" value={`$${(refundTarget.total / 100).toFixed(2)}`} />
                <DetailRow label="Purchaser" value={`${refundTarget.buyerName || "—"} <${refundTarget.buyerEmail || "no email"}>`} />
                <DetailRow label="Event" value={events[refundTarget.eventId]?.title || refundTarget.eventId} />
              </div>

              {refundCheckIn && refundCheckIn.scanned > 0 && (
                <div style={{ padding: "12px 14px", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8, color: "#92400e", fontSize: 13, fontWeight: 600 }}>
                  ⚠ {refundCheckIn.scanned} of {refundCheckIn.total} pass{refundCheckIn.total !== 1 ? "es" : ""} on this order already scanned in at the door.
                  Refunding a checked-in ticket is unusual — make sure that&apos;s intended before confirming.
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Staff note (optional)</label>
                <textarea
                  value={refundNote} onChange={e => setRefundNote(e.target.value)} rows={3}
                  style={{ ...INPUT, resize: "vertical" }}
                  placeholder="Reason for refund, for the audit trail"
                />
              </div>
            </div>
            <div style={{ padding: "16px 28px", borderTop: "1px solid #f3f4f6", display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setRefundTarget(null)} disabled={refunding} style={{ padding: "10px 20px", borderRadius: 8, background: "#f3f4f6", border: "none", cursor: refunding ? "default" : "pointer", fontSize: 14, opacity: refunding ? 0.6 : 1 }}>
                Cancel
              </button>
              <button onClick={submitRefund} disabled={refunding} style={{ padding: "10px 24px", borderRadius: 8, background: "#b91c1c", color: "#fff", border: "none", cursor: refunding ? "default" : "pointer", fontSize: 14, fontWeight: 600, opacity: refunding ? 0.7 : 1 }}>
                {refunding ? "Refunding..." : "Confirm Refund"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14 }}>
      <span style={{ color: "#6b7280" }}>{label}</span>
      <span style={{ fontWeight: 600, color: "#111827", textAlign: "right" }}>{value}</span>
    </div>
  )
}

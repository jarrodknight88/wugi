"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  doc, onSnapshot, collection, updateDoc, addDoc,
  serverTimestamp, writeBatch, increment, query, where,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuthContext } from "@/context/AuthContext"
import DashboardLayout from "@/components/DashboardLayout"
import { GROUP_COLORS } from "@/components/TableGroupManager"
import Link from "next/link"

// ── Types ─────────────────────────────────────────────────────────────
type EventDoc   = { id: string; title: string; venue: string; venueId: string; date: string; time: string }
type TicketType = { id: string; name: string; price: number; color: string; capacity: number; sold: number; remaining: number; active: boolean }
type Ticket = {
  id: string; holderName: string; holderEmail: string; ticketTypeId: string
  ticketTypeName: string; color: string; checkedIn: boolean; checkedInAt?: any
  status: string; tableAssignment?: string; passUpdatedAt?: any
  source?: string
  depositPaid?: number
  balanceDue?: number
  passColor?: string     // passes collection uses passColor not color
  scanStatus?: string    // passes collection uses scanStatus not checkedIn
}
type TableGroup = { id: string; name: string; color: string }
type SortKey    = "name" | "type" | "checkin" | "color" | "balance"
type FilterKey  = "all" | "checked" | "unchecked" | "balance"

// ── Shared styles ─────────────────────────────────────────────────────
const INPUT: React.CSSProperties = { padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" }
const LABEL: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }

// ── Color picker dots ─────────────────────────────────────────────────
function ColorDots({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {GROUP_COLORS.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)} style={{
          width: 20, height: 20, borderRadius: "50%", background: c, border: "none", cursor: "pointer",
          outline: value === c ? `3px solid ${c}` : "none", outlineOffset: 2,
          transform: value === c ? "scale(1.25)" : "scale(1)", transition: "transform 0.1s",
        }} />
      ))}
    </div>
  )
}

// ── Overlay + ModalBox helpers ────────────────────────────────────────
function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 480 }}>{children}</div>
    </div>
  )
}
function ModalBox({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
      <div style={{ padding: "18px 22px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h3>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af" }}>×</button>
      </div>
      <div style={{ padding: "18px 22px" }}>{children}</div>
    </div>
  )
}

// ── Walk-in Modal ─────────────────────────────────────────────────────
function WalkinModal({
  ticketTypes, eventId, eventTitle, onClose, onCreated,
}: {
  ticketTypes: TicketType[]; eventId: string; eventTitle: string
  onClose: () => void; onCreated: (msg: string) => void
}) {
  const [typeId, setTypeId]       = useState(ticketTypes[0]?.id || "")
  const [name, setName]           = useState("")
  const [email, setEmail]         = useState("")
  const [table, setTable]         = useState("")
  const [deposit, setDeposit]     = useState("")   // dollar string
  const [balance, setBalance]     = useState("")   // dollar string
  const [sendEmail, setSendEmail] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState("")

  const selectedType = ticketTypes.find(t => t.id === typeId)

  async function submit() {
    if (!name.trim()) { setError("Name is required"); return }
    if (!typeId) { setError("Select a ticket type"); return }
    if (selectedType && selectedType.remaining <= 0) { setError("This tier is sold out"); return }
    setSaving(true); setError("")
    try {
      const depositCents = deposit ? Math.round(parseFloat(deposit) * 100) : 0
      const balanceCents = balance ? Math.round(parseFloat(balance) * 100) : 0
      // Create ticket doc
      const ticketRef = await addDoc(collection(db, "events", eventId, "tickets"), {
        holderName: name.trim(),
        holderEmail: email.trim(),
        ticketTypeId: typeId,
        ticketTypeName: selectedType?.name || "",
        color: selectedType?.color || "",
        price: selectedType?.price || 0,
        checkedIn: false,
        status: "valid",
        source: "door",
        tableAssignment: table.trim(),
        depositPaid: depositCents,
        balanceDue: balanceCents,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      // Decrement remaining on the ticket type
      await updateDoc(doc(db, "events", eventId, "ticketTypes", typeId), {
        sold: increment(1),
        remaining: increment(-1),
        updatedAt: serverTimestamp(),
      })
      // Optionally send email via Resend Cloud Function
      if (sendEmail && email.trim()) {
        await fetch(`https://us-central1-wugi-prod.cloudfunctions.net/sendEmail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: email.trim(), toName: name.trim(),
            subject: `Your ticket to ${eventTitle}`,
            type: "ticket_confirmation",
            ticketId: ticketRef.id,
            ticketTypeName: selectedType?.name || "",
            eventTitle,
          }),
        }).catch(() => {}) // fire-and-forget
      }
      onCreated(`✓ Walk-in ticket created for ${name.trim()}${sendEmail && email ? " · email sent" : ""}`)
      onClose()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Overlay onClose={onClose}>
      <ModalBox title="Add Walk-in / Door Sale" onClose={onClose}>
        {error && <div style={{ padding: "8px 12px", background: "#fee2e2", borderRadius: 7, color: "#b91c1c", fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={LABEL}>Ticket Type *</label>
            <select style={INPUT} value={typeId} onChange={e => setTypeId(e.target.value)}>
              {ticketTypes.map(t => <option key={t.id} value={t.id}>{t.name} — ${(t.price / 100).toFixed(2)} ({t.remaining} left)</option>)}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ gridColumn: "1/-1" }}>
              <label style={LABEL}>Full Name *</label>
              <input style={INPUT} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Jordan Smith" />
            </div>
            <div style={{ gridColumn: "1/-1" }}>
              <label style={LABEL}>Email</label>
              <input style={INPUT} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="optional" />
            </div>
            <div style={{ gridColumn: "1/-1" }}>
              <label style={LABEL}>Table Assignment</label>
              <input style={INPUT} value={table} onChange={e => setTable(e.target.value)} placeholder="e.g. VIP Table 3" />
            </div>
            <div>
              <label style={LABEL}>Deposit Paid ($)</label>
              <input style={INPUT} type="number" min={0} step={0.01} value={deposit} onChange={e => setDeposit(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label style={LABEL}>Balance Due at Door ($)</label>
              <input style={INPUT} type="number" min={0} step={0.01} value={balance} onChange={e => setBalance(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          {email && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "#374151" }}>
              <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} style={{ width: 15, height: 15 }} />
              Send ticket confirmation email to {email || "guest"}
            </label>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18, paddingTop: 14, borderTop: "1px solid #f3f4f6" }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 13 }}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ padding: "8px 20px", borderRadius: 8, background: "#111827", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
            {saving ? "Creating…" : "Create Ticket"}
          </button>
        </div>
      </ModalBox>
    </Overlay>
  )
}

// ── Balance Editor (inline) ───────────────────────────────────────────
function BalanceEditor({ ticket, onSave, onClose }: {
  ticket: Ticket
  onSave: (ticketId: string, depositCents: number, balanceCents: number) => Promise<void>
  onClose: () => void
}) {
  const [deposit, setDeposit] = useState(((ticket.depositPaid ?? 0) / 100).toFixed(2))
  const [balance, setBalance] = useState(((ticket.balanceDue ?? 0) / 100).toFixed(2))
  const [saving, setSaving]   = useState(false)

  async function submit() {
    setSaving(true)
    await onSave(ticket.id, Math.round(parseFloat(deposit || "0") * 100), Math.round(parseFloat(balance || "0") * 100))
    setSaving(false)
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f3f4f6" }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "#374151", margin: "0 0 8px" }}>Balance Due at Door</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 3 }}>Deposit Paid ($)</label>
          <input style={{ ...INPUT, width: 110, fontSize: 13 }} type="number" min={0} step={0.01} value={deposit} onChange={e => setDeposit(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 3 }}>Balance Due ($)</label>
          <input style={{ ...INPUT, width: 110, fontSize: 13 }} type="number" min={0} step={0.01} value={balance} onChange={e => setBalance(e.target.value)} />
        </div>
        <button onClick={submit} disabled={saving} style={{ padding: "8px 14px", borderRadius: 7, background: "#111827", color: "#fff", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
          {saving ? "…" : "Save"}
        </button>
        <button onClick={onClose} style={{ padding: "8px 12px", borderRadius: 7, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 12, color: "#6b7280" }}>Cancel</button>
      </div>
      {(parseFloat(balance) > 0) && (
        <p style={{ fontSize: 11, color: "#92400e", marginTop: 6, background: "#fffbeb", padding: "4px 8px", borderRadius: 5, display: "inline-block" }}>
          ⚠️ ${parseFloat(balance || "0").toFixed(2)} will show as a warning on the scanner
        </p>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────
export default function CheckinPage({ params }: { params: Promise<{ eventId: string }> }) {
  const router = useRouter()
  const { user, loading, hasDashboardAccess } = useAuthContext()
  const [eventId, setEventId]       = useState("")
  const [event, setEvent]           = useState<EventDoc | null>(null)
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([])
  const [tickets, setTickets]       = useState<Ticket[]>([])
  const [tableGroups, setTableGroups] = useState<TableGroup[]>([])
  // UI state
  const [search, setSearch]         = useState("")
  const [sortKey, setSortKey]       = useState<SortKey>("name")
  const [filter, setFilter]         = useState<FilterKey>("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [colorPanel, setColorPanel] = useState<"none" | "type" | "group">("none")
  // Per-ticket expanded state (independent of colorPanel)
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null)
  const [expandedSection, setExpandedSection]   = useState<"color" | "balance" | null>(null)
  // Modals
  const [showWalkin, setShowWalkin] = useState(false)
  const [saving, setSaving]         = useState(false)
  const [toast, setToast]           = useState<string | null>(null)

  useEffect(() => { params.then(p => setEventId(p.eventId)) }, [params])
  useEffect(() => { if (loading) return; if (!user) router.replace("/login") }, [loading, user, router])

  useEffect(() => {
    if (!eventId) return
    const u1 = onSnapshot(doc(db, "events", eventId), snap => {
      if (!snap.exists()) return
      const d = snap.data()!
      setEvent({ id: snap.id, title: d.title || "", venue: d.venue || "", venueId: d.venueId || "", date: d.date || "", time: d.time || "" })
    })
    const u2 = onSnapshot(collection(db, "events", eventId, "ticketTypes"), snap =>
      setTicketTypes(snap.docs.map(d => ({
        id: d.id, name: d.data().name || "", price: d.data().price || 0,
        color: d.data().color || "#2a7a5a", capacity: d.data().capacity || 0,
        sold: d.data().sold || 0, remaining: d.data().remaining ?? d.data().capacity ?? 0,
        active: d.data().active !== false,
      })))
    )
    // ── Query passes collection (new data model) ───────────────────
    const passesQuery = query(
      collection(db, "passes"),
      where("eventId", "==", eventId),
    )
    const u3 = onSnapshot(passesQuery, snap =>
      setTickets(snap.docs
        .filter(d => d.data().source !== 'door') // client-side filter
        .map(d => ({
          id: d.id,
          holderName: d.data().holderName || "",
          holderEmail: d.data().holderEmail || "",
          ticketTypeId: d.data().ticketTypeId || "",
          ticketTypeName: d.data().ticketTypeName || "",
          color: d.data().passColor || d.data().color || "",
          passColor: d.data().passColor || "",
          checkedIn: d.data().scanStatus === "scanned",
          checkedInAt: d.data().scannedAt,
          status: d.data().scanStatus || "valid",
          tableAssignment: d.data().tableAssignment || "",
          passUpdatedAt: d.data().updatedAt,
          source: d.data().source || "",
          depositPaid: d.data().depositPaid ?? 0,
          balanceDue: d.data().balanceDue ?? 0,
          scanStatus: d.data().scanStatus || "valid",
        })))
    )
    return () => { u1(); u2(); u3() }
  }, [eventId])

  useEffect(() => {
    if (!event?.venueId) return
    return onSnapshot(collection(db, "venues", event.venueId, "tableGroups"), snap =>
      setTableGroups(snap.docs.map(d => ({ id: d.id, name: d.data().name || "", color: d.data().color || "#2a7a5a" })))
    )
  }, [event?.venueId])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2800) }

  function toggleExpanded(ticketId: string, section: "color" | "balance") {
    if (expandedTicketId === ticketId && expandedSection === section) {
      setExpandedTicketId(null); setExpandedSection(null)
    } else {
      setExpandedTicketId(ticketId); setExpandedSection(section)
    }
  }

  // ── Actions ───────────────────────────────────────────────────────
  async function toggleCheckin(ticket: Ticket) {
    const isCheckedIn = ticket.checkedIn
    // Update passes collection doc (new data model)
    await updateDoc(doc(db, "passes", ticket.id), {
      scanStatus: isCheckedIn ? "valid" : "scanned",
      scannedAt: !isCheckedIn ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    })
    showToast(!isCheckedIn ? `✓ ${ticket.holderName} checked in` : `↩ ${ticket.holderName} unchecked`)
  }

  async function assignColorToTicket(ticketId: string, color: string) {
    // Update passes collection doc
    await updateDoc(doc(db, "passes", ticketId), { passColor: color, updatedAt: serverTimestamp() })
    showToast("Color updated")
    setExpandedTicketId(null); setExpandedSection(null)
  }

  async function saveBalance(ticketId: string, depositCents: number, balanceCents: number) {
    await updateDoc(doc(db, "passes", ticketId), {
      depositPaid: depositCents, balanceDue: balanceCents, updatedAt: serverTimestamp(),
    })
    showToast("Balance updated")
    setExpandedTicketId(null); setExpandedSection(null)
  }

  async function assignColorToType(typeId: string, color: string) {
    setSaving(true)
    try {
      await updateDoc(doc(db, "events", eventId, "ticketTypes", typeId), { color, updatedAt: serverTimestamp() })
      // Update all matching passes
      const batch = writeBatch(db)
      tickets.filter(t => t.ticketTypeId === typeId).forEach(t =>
        batch.update(doc(db, "passes", t.id), { passColor: color, updatedAt: serverTimestamp() })
      )
      await batch.commit()
      showToast("Color applied to all tickets of this type")
    } finally { setSaving(false) }
  }

  async function assignColorToGroup(group: TableGroup) {
    setSaving(true)
    try {
      const batch = writeBatch(db)
      tickets.filter(t => t.ticketTypeName.toLowerCase() === group.name.toLowerCase()).forEach(t =>
        batch.update(doc(db, "passes", t.id), { passColor: group.color, updatedAt: serverTimestamp() })
      )
      await batch.commit()
      showToast(`Color applied to "${group.name}" tickets`)
    } finally { setSaving(false) }
  }

  // ── Filtering / sorting ───────────────────────────────────────────
  const displayed = tickets
    .filter(t => filter === "all" ? true : filter === "checked" ? t.checkedIn : filter === "unchecked" ? !t.checkedIn : (t.balanceDue ?? 0) > 0)
    .filter(t => typeFilter === "all" || t.ticketTypeId === typeFilter)
    .filter(t => { const q = search.toLowerCase(); return !q || t.holderName.toLowerCase().includes(q) || t.holderEmail.toLowerCase().includes(q) })
    .sort((a, b) => {
      if (sortKey === "name")    return a.holderName.localeCompare(b.holderName)
      if (sortKey === "type")    return a.ticketTypeName.localeCompare(b.ticketTypeName)
      if (sortKey === "checkin") return Number(b.checkedIn) - Number(a.checkedIn)
      if (sortKey === "color")   return (a.color || "").localeCompare(b.color || "")
      if (sortKey === "balance") return (b.balanceDue ?? 0) - (a.balanceDue ?? 0)
      return 0
    })

  const totalChecked  = tickets.filter(t => t.checkedIn).length
  const totalBalance  = tickets.filter(t => (t.balanceDue ?? 0) > 0).length
  const checkinPct    = tickets.length > 0 ? Math.round((totalChecked / tickets.length) * 100) : 0

  if (loading || !user || !hasDashboardAccess) return null
  if (!event) return <DashboardLayout><div className="dash-page" style={{ color: "#9ca3af" }}>Loading...</div></DashboardLayout>

  return (
    <DashboardLayout>
      <div className="dash-page">

        {/* Toast */}
        {toast && <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#111827", color: "#fff", padding: "12px 24px", borderRadius: 10, fontSize: 14, fontWeight: 600, zIndex: 9999, boxShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>{toast}</div>}

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <Link href={`/dashboard/events/${eventId}`} style={{ fontSize: 13, color: "#6b7280", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 8 }}>← {event.title}</Link>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111827", margin: 0 }}>Check-in</h1>
              <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{event.venue} · {event.date} {event.time}</p>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {/* Live counter */}
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: "10px 18px", textAlign: "center", minWidth: 110 }}>
                <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#111827" }}>{totalChecked}<span style={{ fontSize: 13, color: "#9ca3af", fontWeight: 400 }}>/{tickets.length}</span></p>
                <div style={{ background: "#f3f4f6", borderRadius: 4, height: 4, marginTop: 5, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${checkinPct}%`, background: "#2a7a5a", borderRadius: 4, transition: "width 0.3s" }} />
                </div>
                <p style={{ margin: "3px 0 0", fontSize: 11, color: "#9ca3af" }}>{checkinPct}% in</p>
              </div>
              {totalBalance > 0 && (
                <div style={{ background: "#fffbeb", borderRadius: 12, border: "1px solid #fde68a", padding: "10px 18px", textAlign: "center", minWidth: 90 }}>
                  <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#92400e" }}>{totalBalance}</p>
                  <p style={{ margin: "3px 0 0", fontSize: 11, color: "#a16207" }}>balance due</p>
                </div>
              )}
              {/* Walk-in button */}
              <button onClick={() => setShowWalkin(true)} style={{ padding: "10px 18px", borderRadius: 8, background: "#7c3aed", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                + Walk-in
              </button>
            </div>
          </div>
        </div>

        {/* Assign Colors panel */}
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: "14px 18px", marginBottom: 14 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 8px" }}>Assign Colors</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["type", "group"] as const).map(p => (
              (p === "group" && tableGroups.length === 0) ? null :
              <button key={p} onClick={() => setColorPanel(colorPanel === p ? "none" : p)}
                style={{ padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none", background: colorPanel === p ? "#111827" : "#f3f4f6", color: colorPanel === p ? "#fff" : "#374151" }}>
                {p === "type" ? "By Ticket Type" : "By Table Group"}
              </button>
            ))}
          </div>
          {colorPanel === "type" && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {ticketTypes.map(tt => (
                <div key={tt.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: tt.color }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", minWidth: 100 }}>{tt.name}</span>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>({tt.sold} sold)</span>
                  <ColorDots value={tt.color} onChange={c => assignColorToType(tt.id, c)} />
                </div>
              ))}
              <p style={{ fontSize: 11, color: "#9ca3af", margin: 0 }}>Updates all existing tickets of that type + sets default for new ones.</p>
            </div>
          )}
          {colorPanel === "group" && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 8px" }}>Applies group color to tickets whose tier name matches the group name.</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {tableGroups.map(g => (
                  <button key={g.id} onClick={() => assignColorToGroup(g)}
                    style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer", background: g.color, color: "#fff", border: "none" }}>
                    {g.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ ...INPUT, maxWidth: 220 }} placeholder="Search name or email…" value={search} onChange={e => setSearch(e.target.value)} />
          {(["all","unchecked","checked","balance"] as FilterKey[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              style={{ padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none", background: filter === f ? "#111827" : "#f3f4f6", color: filter === f ? "#fff" : "#6b7280" }}>
              {f === "all" ? "All" : f === "checked" ? "✓ In" : f === "unchecked" ? "⏳ Pending" : "💰 Balance Due"}
            </button>
          ))}
          <select style={{ ...INPUT, width: "auto", fontSize: 12 }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            {ticketTypes.map(tt => <option key={tt.id} value={tt.id}>{tt.name}</option>)}
          </select>
          <select style={{ ...INPUT, width: "auto", fontSize: 12 }} value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}>
            <option value="name">Sort: Name</option>
            <option value="type">Sort: Type</option>
            <option value="checkin">Sort: Check-in</option>
            <option value="color">Sort: Color</option>
            <option value="balance">Sort: Balance</option>
          </select>
        </div>
        <p style={{ fontSize: 12, color: "#9ca3af", margin: "0 0 10px" }}>{displayed.length} of {tickets.length} shown</p>

        {/* Ticket list */}
        {tickets.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 48, textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🎟</div>
            <p style={{ fontSize: 15, fontWeight: 600, color: "#374151", margin: "0 0 6px" }}>No tickets yet</p>
            <p style={{ fontSize: 14, color: "#9ca3af", margin: "0 0 16px" }}>Tickets appear here once purchased, or use "+ Walk-in" to add door sales.</p>
            <button onClick={() => setShowWalkin(true)} style={{ padding: "9px 20px", borderRadius: 8, background: "#7c3aed", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>+ Walk-in</button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {displayed.map(ticket => {
              const typeColor = ticket.color || ticketTypes.find(t => t.id === ticket.ticketTypeId)?.color || "#2a7a5a"
              const hasBalance = (ticket.balanceDue ?? 0) > 0
              const isColorExpanded   = expandedTicketId === ticket.id && expandedSection === "color"
              const isBalanceExpanded = expandedTicketId === ticket.id && expandedSection === "balance"

              return (
                <div key={ticket.id} style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", borderLeft: `5px solid ${typeColor}`, padding: "12px 14px", opacity: ticket.status === "refunded" ? 0.5 : 1 }}>

                  {/* Main row */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {/* Check-in circle */}
                    <button onClick={() => toggleCheckin(ticket)} style={{
                      width: 34, height: 34, borderRadius: "50%", border: "2px solid",
                      cursor: "pointer", fontSize: 15, flexShrink: 0,
                      background: ticket.checkedIn ? "#2a7a5a" : "#fff",
                      borderColor: ticket.checkedIn ? "#2a7a5a" : "#d1d5db",
                      color: ticket.checkedIn ? "#fff" : "#9ca3af",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>{ticket.checkedIn ? "✓" : ""}</button>

                    {/* Name + email */}
                    <div style={{ flex: 1, minWidth: 130 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#111827" }}>{ticket.holderName || "—"}</p>
                        {ticket.source === "door" && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "#f5f3ff", color: "#7c3aed", fontWeight: 700 }}>DOOR</span>}
                      </div>
                      <p style={{ margin: "1px 0 0", fontSize: 12, color: "#6b7280" }}>{ticket.holderEmail || "no email"}</p>
                    </div>

                    {/* Tier badge */}
                    <span style={{ padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: typeColor + "22", color: typeColor }}>{ticket.ticketTypeName}</span>

                    {/* Table */}
                    {ticket.tableAssignment && <span style={{ fontSize: 12, color: "#6b7280" }}>🪑 {ticket.tableAssignment}</span>}

                    {/* Balance warning */}
                    {hasBalance && (
                      <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }}>
                        ⚠️ ${((ticket.balanceDue ?? 0) / 100).toFixed(2)} due
                      </span>
                    )}

                    {/* Check-in time */}
                    {ticket.checkedIn && ticket.checkedInAt && (
                      <span style={{ fontSize: 11, color: "#9ca3af" }}>{ticket.checkedInAt?.toDate?.()?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) || ""}</span>
                    )}

                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: 4 }}>
                      {/* Color dot — independent of colorPanel */}
                      <button onClick={() => toggleExpanded(ticket.id, "color")} title="Set ticket color"
                        style={{ width: 24, height: 24, borderRadius: "50%", background: typeColor, border: isColorExpanded ? "2px solid #111827" : "2px solid #fff", cursor: "pointer", boxShadow: "0 0 0 1px #e5e7eb", flexShrink: 0 }} />
                      {/* Balance button */}
                      <button onClick={() => toggleExpanded(ticket.id, "balance")} title="Set balance due"
                        style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", background: isBalanceExpanded ? "#111827" : "#f3f4f6", color: isBalanceExpanded ? "#fff" : "#374151", border: "none" }}>
                        💰
                      </button>
                    </div>
                  </div>

                  {/* Expanded: per-ticket color picker */}
                  {isColorExpanded && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f3f4f6" }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: "#374151", margin: "0 0 6px" }}>Color for this ticket only</p>
                      <ColorDots value={ticket.color || ""} onChange={c => assignColorToTicket(ticket.id, c)} />
                    </div>
                  )}

                  {/* Expanded: balance editor */}
                  {isBalanceExpanded && (
                    <BalanceEditor ticket={ticket} onSave={saveBalance} onClose={() => { setExpandedTicketId(null); setExpandedSection(null) }} />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Walk-in modal */}
        {showWalkin && event && (
          <WalkinModal ticketTypes={ticketTypes.filter(t => t.active && t.remaining > 0)} eventId={eventId} eventTitle={event.title}
            onClose={() => setShowWalkin(false)} onCreated={msg => { showToast(msg); setShowWalkin(false) }} />
        )}
      </div>
    </DashboardLayout>
  )
}

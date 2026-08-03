"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { collection, doc, setDoc, updateDoc, onSnapshot, getDoc, serverTimestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuthContext } from "@/context/AuthContext"
import { logAudit } from "@/lib/auditLog"
import VenuePicker from "@/components/VenuePicker"
import MediaManager from "@/components/MediaManager"
import ConfirmDialog from "@/components/ConfirmDialog"
import { reorderSelectedMedia, type SelectedMedia } from "@/lib/mediaSelection"

// Doc shape mirrors the top-level `itineraries` collection the consumer app
// reads read-only (mobile-app/firestoreService.ts's getEditorialShelves() /
// getItineraryById()) and renders in
// mobile-app/src/screens/ItineraryDetailScreen.tsx, whose `cards` array is
// typed as EditorialCard[] in mobile-app/src/types/index.ts. Stop cards here
// carry every field ItineraryDetailScreen's StopRow reads (kind, venueId,
// title, sub, image, tag, tagColor) plus a dashboard-only `note` field the
// consumer app ignores — kept so re-opening a stop for edit doesn't confuse
// a curated note with the auto-generated "Venue" fallback that lands in
// `sub`. Structure (hero card + ordered stop cards, first-image-from-media
// convention) matches mobile-app/scripts/seed-itineraries.ts, the only prior
// writer of this collection.
const KICKER = "WEEKEND ITINERARY"
const HERO_COLOR = "#5fa080"
const STOP_COLORS = ["#d49a6a", "#5ba8c4", "#5fa080", "#95a5a6"]

type Stop = { venueId: string; venueName: string; image: string; note: string }
type Card = {
  kind: string; title: string; sub: string; image: string
  tag: string; tagColor: string; ratio?: number; venueId?: string; note?: string
}
type Itinerary = {
  id: string; title: string; neighborhood: string; coverImage: string
  cards: Card[]; order: number; status: string
}
type Form = {
  title: string; neighborhood: string; media: SelectedMedia[]
  stops: Stop[]; order: number; status: "draft" | "live" | "archived"
}

const EMPTY: Form = { title: "", neighborhood: "", media: [], stops: [], order: 999, status: "draft" }

const INPUT: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" }
const LABEL: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#374151" }
const HINT: React.CSSProperties = { fontSize: 12, color: "#9ca3af", margin: 0, lineHeight: 1.5 }
const CARD: React.CSSProperties = { background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "hidden" }

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase" as const, color: "#6b7280" }}>{title}</p>
        {hint && <p style={{ ...HINT, marginTop: 3 }}>{hint}</p>}
      </div>
      {children}
    </div>
  )
}

// Mirrors mobile-app/scripts/seed-itineraries.ts's firstImage() — venue
// `media` is either legacy string URLs or {uri} objects.
function firstImage(v: Record<string, unknown>): string {
  const media = Array.isArray(v.media) ? v.media : []
  for (const m of media) {
    if (typeof m === "string") return m
    if (m && typeof (m as { uri?: unknown }).uri === "string") return (m as { uri: string }).uri
  }
  return ""
}

function stopsFromCards(cards: Card[] | undefined): Stop[] {
  return (cards || [])
    .filter((c) => c.kind === "stop" && c.venueId)
    .map((c) => ({ venueId: c.venueId!, venueName: c.title, image: c.image || "", note: typeof c.note === "string" ? c.note : "" }))
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  live: { bg: "#dcfce7", color: "#15803d" },
  draft: { bg: "#fef9c3", color: "#a16207" },
  archived: { bg: "#f3f4f6", color: "#6b7280" },
}

export default function ItinerariesPage() {
  const router = useRouter()
  const { user, loading, isSuperAdmin } = useAuthContext()
  const [itineraries, setItineraries] = useState<Itinerary[]>([])
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [stopError, setStopError] = useState("")
  const [newStopVenueId, setNewStopVenueId] = useState("")
  const [addingStop, setAddingStop] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<Itinerary | null>(null)

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
    if (!isSuperAdmin) router.replace("/unauthorized")
  }, [loading, user, isSuperAdmin, router])

  useEffect(() => {
    if (!user || !isSuperAdmin) return
    return onSnapshot(collection(db, "itineraries"), (snap) => {
      const all = snap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          title: data.title || "",
          neighborhood: data.neighborhood || "",
          coverImage: data.coverImage || "",
          cards: data.cards || [],
          order: typeof data.order === "number" ? data.order : 999,
          status: data.status || "draft",
        } as Itinerary
      })
      all.sort((a, b) => a.order - b.order)
      setItineraries(all)
    })
  }, [user, isSuperAdmin])

  function openCreate() {
    setPendingId(doc(collection(db, "itineraries")).id)
    setForm(EMPTY); setEditId(null); setError(""); setStopError(""); setNewStopVenueId(""); setModal(true)
  }

  function openEdit(it: Itinerary) {
    setPendingId(null)
    setForm({
      title: it.title,
      neighborhood: it.neighborhood,
      media: it.coverImage ? [{ uri: it.coverImage, type: "image" }] : [],
      stops: stopsFromCards(it.cards),
      order: it.order,
      status: (it.status as Form["status"]) || "draft",
    })
    setEditId(it.id); setError(""); setStopError(""); setNewStopVenueId(""); setModal(true)
  }

  async function addStop(venueId: string, venueName: string) {
    setStopError("")
    if (form.stops.some((s) => s.venueId === venueId)) {
      setStopError("That venue is already in this route.")
      setNewStopVenueId("")
      return
    }
    setAddingStop(true)
    try {
      const snap = await getDoc(doc(db, "venues", venueId))
      const image = snap.exists() ? firstImage(snap.data()) : ""
      setForm((f) => ({ ...f, stops: [...f.stops, { venueId, venueName, image, note: "" }] }))
    } catch (e) {
      setStopError(e instanceof Error ? e.message : String(e))
    } finally {
      setAddingStop(false)
      setNewStopVenueId("")
    }
  }

  function removeStop(i: number) {
    setForm((f) => ({ ...f, stops: f.stops.filter((_, idx) => idx !== i) }))
  }
  function moveStop(from: number, to: number) {
    setForm((f) => ({ ...f, stops: reorderSelectedMedia(f.stops, from, to) }))
  }
  function updateStopNote(i: number, note: string) {
    setForm((f) => ({ ...f, stops: f.stops.map((s, idx) => (idx === i ? { ...s, note } : s)) }))
  }

  async function save() {
    if (!form.title.trim()) { setError("Title required"); return }
    if (!form.neighborhood.trim()) { setError("Neighborhood required"); return }
    if (form.stops.length === 0) { setError("Add at least one venue stop"); return }
    setSaving(true); setError("")
    try {
      const stopCount = form.stops.length
      const coverImage = form.media[0]?.uri || ""
      const heroCard: Card = {
        kind: "itinerary", title: form.title.trim(),
        sub: `${stopCount} stop${stopCount === 1 ? "" : "s"} · ${form.neighborhood.trim()}`,
        image: coverImage, tag: "ITINERARY", tagColor: HERO_COLOR, ratio: 2,
      }
      const stopCards: Card[] = form.stops.map((s, i) => ({
        kind: "stop", venueId: s.venueId, title: s.venueName,
        sub: s.note.trim() || "Venue", image: s.image,
        tag: `STOP ${i + 1}`, tagColor: STOP_COLORS[i % STOP_COLORS.length],
        note: s.note.trim(),
      }))
      const data = {
        title: form.title.trim(),
        neighborhood: form.neighborhood.trim(),
        kicker: KICKER,
        subtitle: `A curated route · ${stopCount} stop${stopCount === 1 ? "" : "s"}`,
        coverImage,
        cards: [heroCard, ...stopCards],
        order: form.order,
        status: form.status,
        source: "dashboard",
        updatedAt: serverTimestamp(),
      }
      if (editId) {
        await updateDoc(doc(db, "itineraries", editId), data)
        await logAudit({ adminId: user!.uid, adminEmail: user!.email || "", action: "updated_itinerary", targetId: editId, targetName: data.title })
      } else {
        const ref = doc(db, "itineraries", pendingId || doc(collection(db, "itineraries")).id)
        await setDoc(ref, { ...data, createdAt: serverTimestamp() })
        await logAudit({ adminId: user!.uid, adminEmail: user!.email || "", action: "created_itinerary", targetId: ref.id, targetName: data.title })
      }
      setModal(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function setArchived(it: Itinerary, archived: boolean) {
    setError("")
    try {
      const status = archived ? "archived" : "draft"
      await updateDoc(doc(db, "itineraries", it.id), { status, updatedAt: serverTimestamp() })
      await logAudit({
        adminId: user!.uid, adminEmail: user!.email || "",
        action: archived ? "archived_itinerary" : "unarchived_itinerary",
        targetId: it.id, targetName: it.title,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (loading || !user || !isSuperAdmin) return null

  return (
    <>
      <div className="dash-page">
        <div className="dash-header">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0 }}>Itineraries</h1>
            <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>{itineraries.length} curated route{itineraries.length === 1 ? "" : "s"}</p>
          </div>
          <button onClick={openCreate} style={{ padding: "10px 20px", borderRadius: 8, background: "#111827", color: "#fff", border: "none", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>+ New Itinerary</button>
        </div>

        {error && <div style={{ padding: "10px 16px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13, marginBottom: 16 }}>{error}</div>}

        {itineraries.length === 0 ? (
          <div style={{ ...CARD, padding: 48, textAlign: "center" as const }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🗺️</div>
            <p style={{ fontSize: 15, fontWeight: 600, color: "#374151", margin: "0 0 8px" }}>No itineraries yet</p>
            <p style={{ fontSize: 14, color: "#9ca3af", margin: 0 }}>Create a curated multi-stop route to feature on the Discover tab.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
            {itineraries.map((it) => {
              const sc = STATUS_COLORS[it.status] || STATUS_COLORS.draft
              const stopCount = it.cards.filter((c) => c.kind === "stop").length
              return (
                <div key={it.id} style={CARD}>
                  <div style={{ position: "relative", height: 130, background: "#f3f4f6" }}>
                    {it.coverImage && (
                      // eslint-disable-next-line @next/next/no-img-element -- Storage URL
                      <img src={it.coverImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    )}
                    <span style={{ position: "absolute", top: 10, right: 10, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.color }}>{it.status}</span>
                  </div>
                  <div style={{ padding: "14px 18px" }}>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#111827" }}>{it.title || "Untitled"}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7280" }}>{it.neighborhood || "—"} · {stopCount} stop{stopCount === 1 ? "" : "s"}</p>
                  </div>
                  <div style={{ padding: "0 18px 14px", display: "flex", gap: 8 }}>
                    <button onClick={() => openEdit(it)} style={{ flex: 1, padding: "7px 0", borderRadius: 7, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#374151" }}>Edit</button>
                    <button
                      onClick={() => (it.status === "archived" ? setArchived(it, false) : setArchiveTarget(it))}
                      style={{ flex: 1, padding: "7px 0", borderRadius: 7, background: "#fff", border: "1px solid #e5e7eb", cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#6b7280" }}
                    >
                      {it.status === "archived" ? "Unarchive" : "Archive"}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {archiveTarget && (
        <ConfirmDialog
          message={`Archive "${archiveTarget.title || archiveTarget.id}"? It will stop appearing on the Discover tab.`}
          confirmLabel="Archive"
          onConfirm={() => { const it = archiveTarget; setArchiveTarget(null); setArchived(it, true) }}
          onCancel={() => setArchiveTarget(null)}
        />
      )}

      {modal && (
        <div style={{ position: "fixed" as const, inset: 0, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(2px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setModal(false)}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 680, maxHeight: "92vh", display: "flex", flexDirection: "column" as const, boxShadow: "0 24px 70px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>

            <div style={{ padding: "20px 28px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111827" }}>{editId ? "Edit Itinerary" : "New Itinerary"}</h2>
                <p style={{ ...HINT, marginTop: 3 }}>A curated multi-stop route surfaced on the Discover tab.</p>
              </div>
              <button onClick={() => setModal(false)} aria-label="Close" style={{ background: "#f3f4f6", border: "none", width: 30, height: 30, borderRadius: 8, fontSize: 16, cursor: "pointer", color: "#6b7280", lineHeight: 1 }}>×</button>
            </div>

            <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column" as const, gap: 24, overflowY: "auto" as const }}>
              {error && (
                <div style={{ padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#b91c1c", fontSize: 13, display: "flex", gap: 8 }}>
                  <span>⚠</span><span>{error}</span>
                </div>
              )}

              <Section title="Basics">
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                  <label style={LABEL}>Title <span style={{ color: "#b91c1c" }}>*</span></label>
                  <input style={INPUT} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Saturday in Decatur" />
                </div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                  <label style={LABEL}>Neighborhood <span style={{ color: "#b91c1c" }}>*</span></label>
                  <input style={INPUT} value={form.neighborhood} onChange={(e) => setForm((f) => ({ ...f, neighborhood: e.target.value }))} placeholder="e.g. Decatur" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                    <label style={LABEL}>Status</label>
                    <select style={INPUT} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Form["status"] }))}>
                      <option value="draft">Draft</option>
                      <option value="live">Live</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                    <label style={LABEL}>Shelf order</label>
                    <input type="number" style={INPUT} value={form.order} onChange={(e) => setForm((f) => ({ ...f, order: Number(e.target.value) || 0 }))} />
                  </div>
                </div>
              </Section>

              <div style={{ height: 1, background: "#f3f4f6" }} />

              <Section title="Hero image" hint="Shown on the Discover shelf card and the itinerary's detail page.">
                <MediaManager
                  sections={[]}
                  value={form.media}
                  onChange={(media) => setForm((f) => ({ ...f, media: media.slice(-1) }))}
                  upload={{ endpoint: `/api/itineraries/${editId || pendingId}/upload`, accept: "image/*" }}
                />
              </Section>

              <div style={{ height: 1, background: "#f3f4f6" }} />

              <Section title="Route" hint="Ordered venue stops. The first selected stop is #1 on the route.">
                {form.stops.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
                    {form.stops.map((s, i) => (
                      <div key={s.venueId} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 10, border: "1px solid #e5e7eb", borderRadius: 10, background: "#fafafa" }}>
                        <div style={{ width: 48, height: 48, borderRadius: 8, overflow: "hidden", background: "#f3f4f6", flexShrink: 0 }}>
                          {s.image && (
                            // eslint-disable-next-line @next/next/no-img-element -- venue Storage URL
                            <img src={s.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" as const, gap: 6 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#111827" }}>{i + 1}. {s.venueName}</p>
                          <textarea
                            style={{ ...INPUT, minHeight: 44, resize: "vertical" as const, fontSize: 13 }}
                            value={s.note}
                            onChange={(e) => updateStopNote(i, e.target.value)}
                            placeholder="Optional note for this stop (shown on the route)"
                          />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column" as const, gap: 4, flexShrink: 0 }}>
                          <button type="button" disabled={i === 0} onClick={() => moveStop(i, i - 1)} title="Move up" aria-label="Move up" style={{ width: 24, height: 24, borderRadius: 5, border: "1px solid #e5e7eb", background: "#fff", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.35 : 1, fontSize: 11 }}>↑</button>
                          <button type="button" disabled={i === form.stops.length - 1} onClick={() => moveStop(i, i + 1)} title="Move down" aria-label="Move down" style={{ width: 24, height: 24, borderRadius: 5, border: "1px solid #e5e7eb", background: "#fff", cursor: i === form.stops.length - 1 ? "default" : "pointer", opacity: i === form.stops.length - 1 ? 0.35 : 1, fontSize: 11 }}>↓</button>
                          <button type="button" onClick={() => removeStop(i)} title="Remove" aria-label="Remove" style={{ width: 24, height: 24, borderRadius: 5, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", cursor: "pointer", fontSize: 11 }}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <VenuePicker venueId={newStopVenueId} onChange={(id, name) => addStop(id, name)} placeholder={addingStop ? "Adding…" : "Search venues to add a stop..."} disabled={addingStop} />
                {stopError && <p style={{ fontSize: 12, color: "#b91c1c", margin: 0 }}>{stopError}</p>}
              </Section>
            </div>

            <div style={{ padding: "14px 28px", borderTop: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 10 }}>
              <p style={{ ...HINT, flex: 1 }}>Only "Live" itineraries appear on the consumer app's Discover tab.</p>
              <button onClick={() => setModal(false)} style={{ padding: "10px 20px", borderRadius: 8, background: "#fff", border: "1px solid #e5e7eb", cursor: "pointer", fontSize: 14, color: "#374151" }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ padding: "10px 24px", borderRadius: 8, background: "#111827", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
                {saving ? "Saving…" : editId ? "Save Changes" : "Create Itinerary"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

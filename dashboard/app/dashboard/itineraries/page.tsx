"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { collection, doc, setDoc, updateDoc, onSnapshot, serverTimestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuthContext } from "@/context/AuthContext"
import { logAudit } from "@/lib/auditLog"
import ConfirmDialog from "@/components/ConfirmDialog"
import MediaManager from "@/components/MediaManager"
import VenuePicker from "@/components/VenuePicker"
import type { SelectedMedia } from "@/lib/mediaSelection"

// Schema mirrors mobile-app/src/types/index.ts's EditorialShelfBase +
// ItineraryDoc exactly (verified against firestoreService.ts's
// getItineraryById/getEditorialShelves and ItineraryDetailScreen.tsx, which
// render this collection) — a hero 'itinerary' card plus ordered 'stop'
// cards. `note` on a stop card is dashboard-only for listType 'itinerary'
// (inert to the consumer, which only reads `sub`): re-editing needs the
// curator's own note kept separate from the auto-generated `sub` ("Venue" /
// venue category) fallback, or every edit would clobber it. For listType
// 'spot-list' the note IS the guest-visible blurb, so it's written into
// `sub` at save time (see save()). listType/authorName/authorPhoto/
// authorHandle power the Discover influencer components (consumer-side
// rendering of them is a separate task — this page is authoring only).
type EditorialCard = {
  kind: "itinerary" | "stop"
  title: string
  sub: string
  image: string
  tag: string
  tagColor: string
  ratio?: number
  venueId?: string
  note?: string
}

type ListType = "itinerary" | "spot-list"

type Itinerary = {
  id: string
  kicker: string
  title: string
  subtitle: string
  neighborhood: string
  coverImage: string
  cards: EditorialCard[]
  order: number
  status: string
  source: string
  listType?: ListType
  authorName?: string
  authorPhoto?: string
  authorHandle?: string
}

type Stop = { venueId: string; venueName: string; note: string }

type IF = {
  kicker: string; title: string; subtitle: string; neighborhood: string
  order: string; status: string
  media: SelectedMedia[]
  stops: Stop[]
  listType: ListType
  authorName: string
  authorHandle: string
  authorPhotoMedia: SelectedMedia[]
}

const EMPTY: IF = {
  kicker: "WEEKEND ITINERARY", title: "", subtitle: "", neighborhood: "",
  order: "0", status: "draft", media: [], stops: [],
  listType: "itinerary", authorName: "", authorHandle: "", authorPhotoMedia: [],
}

const LIST_TYPES: { value: ListType; label: string; hint: string }[] = [
  { value: "itinerary", label: "Itinerary", hint: "An ordered, multi-stop route a guest follows in sequence." },
  { value: "spot-list", label: "Spot list", hint: "A curated roundup of venues, e.g. “5 spots in Buckhead” — order doesn't imply a route." },
]

// Matches scripts/seed-itineraries.ts's palette exactly so dashboard-authored
// itineraries render identically to the seeded placeholders.
const ITIN_HERO_COLOR = "#5fa080"
const STOP_COLORS = ["#d49a6a", "#5ba8c4", "#5fa080", "#95a5a6"]
const STATUSES = ["draft", "live", "archived"]

const INPUT: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" }
const LABEL: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }
const CARD: React.CSSProperties = { background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "hidden" }
const HINT: React.CSSProperties = { fontSize: 12, color: "#9ca3af", margin: 0, lineHeight: 1.5 }

const SC: Record<string, { bg: string; color: string }> = {
  draft:    { bg: "#fef9c3", color: "#a16207" },
  live:     { bg: "#dcfce7", color: "#15803d" },
  archived: { bg: "#f3f4f6", color: "#6b7280" },
}

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

// Mirrors scripts/seed-itineraries.ts's firstImage() exactly — a venue's
// `media` array can hold bare URL strings (legacy) or {uri} objects.
function firstImage(v: any): string {
  for (const m of (v?.media || [])) {
    if (typeof m === "string") return m
    if (m && typeof m.uri === "string") return m.uri
  }
  return ""
}

export default function ItinerariesPage() {
  const router = useRouter()
  const { user, loading, hasDashboardAccess, isSuperAdmin } = useAuthContext()
  const [itineraries, setItineraries] = useState<Itinerary[]>([])
  const [venuesById, setVenuesById] = useState<Record<string, any>>({})
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<IF>(EMPTY)
  // A brand-new itinerary has no Firestore id yet, but the hero-image upload
  // route is keyed by itineraryId — pre-allocate the doc id at openCreate()
  // (same pattern as series/page.tsx's pendingId) so the image can be
  // uploaded before the first Save.
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [archiveTarget, setArchiveTarget] = useState<Itinerary | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
    if (!isSuperAdmin) { router.replace("/unauthorized"); return }
  }, [loading, user, isSuperAdmin, router])

  useEffect(() => {
    if (!user || !isSuperAdmin) return
    const u1 = onSnapshot(collection(db, "itineraries"), s => {
      const all = s.docs.map(d => ({ id: d.id, ...d.data() } as Itinerary))
      all.sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      setItineraries(all)
    })
    // Full venue docs (not the leaner /api/venue-intel/venues list VenuePicker
    // uses for search) — building a stop card needs each venue's category and
    // media, which that endpoint doesn't return.
    const u2 = onSnapshot(collection(db, "venues"), s => {
      const map: Record<string, any> = {}
      s.docs.forEach(d => { map[d.id] = d.data() })
      setVenuesById(map)
    })
    return () => { u1(); u2() }
  }, [user, isSuperAdmin])

  function openCreate() {
    setPendingId(doc(collection(db, "itineraries")).id)
    setForm(EMPTY); setEditId(null); setModal(true); setError("")
  }

  function openEdit(it: Itinerary) {
    setPendingId(null)
    const stopCards = (it.cards || []).filter(c => c.kind === "stop")
    setForm({
      kicker: it.kicker || "WEEKEND ITINERARY",
      title: it.title || "",
      subtitle: it.subtitle || "",
      neighborhood: it.neighborhood || "",
      order: String(it.order ?? 0),
      status: it.status || "draft",
      media: it.coverImage ? [{ uri: it.coverImage, type: "image" }] : [],
      stops: stopCards.map(c => ({ venueId: c.venueId || "", venueName: c.title, note: c.note || "" })),
      listType: it.listType || "itinerary",
      authorName: it.authorName || "",
      authorHandle: it.authorHandle || "",
      authorPhotoMedia: it.authorPhoto ? [{ uri: it.authorPhoto, type: "image" }] : [],
    })
    setEditId(it.id); setModal(true); setError("")
  }

  function addStop(venueId: string, venueName: string) {
    if (!venueId) return
    if (form.stops.some(s => s.venueId === venueId)) { setError("That venue is already a stop on this route"); return }
    setError("")
    setForm(f => ({ ...f, stops: [...f.stops, { venueId, venueName, note: "" }] }))
  }
  function moveStop(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= form.stops.length) return
    setForm(f => {
      const copy = [...f.stops]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return { ...f, stops: copy }
    })
  }
  function removeStop(i: number) {
    setForm(f => ({ ...f, stops: f.stops.filter((_, idx) => idx !== i) }))
  }
  function setStopNote(i: number, note: string) {
    setForm(f => ({ ...f, stops: f.stops.map((s, idx) => idx === i ? { ...s, note } : s) }))
  }

  async function save() {
    if (!form.title.trim())        { setError("Title is required"); return }
    if (!form.neighborhood.trim()) { setError("Neighborhood is required"); return }
    if (form.stops.length === 0)   { setError("Add at least one stop"); return }
    setSaving(true); setError("")
    try {
      const coverImage = form.media[0]?.uri || ""
      const authorPhoto = form.authorPhotoMedia[0]?.uri || ""
      const isSpotList = form.listType === "spot-list"
      const stopCards: EditorialCard[] = form.stops.map((s, i) => {
        const v = venuesById[s.venueId] || {}
        const note = s.note.trim()
        return {
          kind: "stop", venueId: s.venueId,
          title: v.name || s.venueName || "Venue",
          // A spot-list's blurb is guest-visible, so it's written into `sub`
          // (the only stop-card field the consumer reads); an itinerary's
          // note stays curator-only and `sub` keeps the venue category.
          sub: isSpotList ? (note || v.category || "Venue") : (v.category || "Venue"),
          image: firstImage(v),
          tag: `STOP ${i + 1}`, tagColor: STOP_COLORS[i % STOP_COLORS.length],
          note,
        }
      })
      const heroCard: EditorialCard = {
        kind: "itinerary", title: form.title.trim(),
        sub: `${stopCards.length} stop${stopCards.length === 1 ? "" : "s"} · ${form.neighborhood.trim()}`,
        image: coverImage || stopCards[0]?.image || "",
        tag: "ITINERARY", tagColor: ITIN_HERO_COLOR, ratio: 2,
      }
      const data = {
        kicker: form.kicker.trim() || "WEEKEND ITINERARY",
        title: form.title.trim(),
        subtitle: form.subtitle.trim(),
        neighborhood: form.neighborhood.trim(),
        coverImage,
        cards: [heroCard, ...stopCards],
        order: Number(form.order) || 0,
        status: form.status,
        source: "dashboard",
        listType: form.listType,
        authorName: form.authorName.trim(),
        authorHandle: form.authorHandle.trim(),
        authorPhoto,
        updatedAt: serverTimestamp(),
      }
      if (editId) {
        await updateDoc(doc(db, "itineraries", editId), data)
        await logAudit({ adminId: user!.uid, adminEmail: user!.email!, action: "updated_itinerary", targetId: editId, targetName: form.title })
      } else {
        const ref = doc(db, "itineraries", pendingId || doc(collection(db, "itineraries")).id)
        await setDoc(ref, { ...data, createdAt: serverTimestamp() })
        await logAudit({ adminId: user!.uid, adminEmail: user!.email!, action: "created_itinerary", targetId: ref.id, targetName: form.title })
      }
      setModal(false)
    } catch (e: any) { setError(e.message) } finally { setSaving(false) }
  }

  async function archive(it: Itinerary) {
    setBusyId(it.id); setError("")
    try {
      await updateDoc(doc(db, "itineraries", it.id), { status: "archived", updatedAt: serverTimestamp() })
      await logAudit({ adminId: user!.uid, adminEmail: user!.email!, action: "archived_itinerary", targetId: it.id, targetName: it.title })
    } catch (e: any) { setError(e.message) } finally { setBusyId(null); setArchiveTarget(null) }
  }
  async function unarchive(it: Itinerary) {
    setBusyId(it.id); setError("")
    try {
      await updateDoc(doc(db, "itineraries", it.id), { status: "draft", updatedAt: serverTimestamp() })
      await logAudit({ adminId: user!.uid, adminEmail: user!.email!, action: "unarchived_itinerary", targetId: it.id, targetName: it.title })
    } catch (e: any) { setError(e.message) } finally { setBusyId(null) }
  }

  if (loading || !user || !isSuperAdmin || !hasDashboardAccess) return null

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
            <p style={{ fontSize: 14, color: "#9ca3af", margin: 0 }}>Create a curated multi-stop route — it appears as an editorial shelf on the consumer app's Discover tab.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
            {itineraries.map(it => {
              const sc = SC[it.status] || SC.draft
              const stopCount = (it.cards || []).filter(c => c.kind === "stop").length
              return (
                <div key={it.id} style={CARD}>
                  <div style={{ height: 120, background: it.coverImage ? `center/cover url(${it.coverImage})` : "#111827", position: "relative" }}>
                    <span style={{ position: "absolute", top: 10, right: 10, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.color }}>{it.status}</span>
                    {it.listType === "spot-list" && (
                      <span style={{ position: "absolute", top: 10, left: 10, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: "rgba(17,24,39,0.75)", color: "#fff" }}>Spot list</span>
                    )}
                  </div>
                  <div style={{ padding: "14px 18px" }}>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#111827" }}>{it.title}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7280" }}>{it.neighborhood} · {stopCount} stop{stopCount === 1 ? "" : "s"}{it.authorName ? ` · curated by ${it.authorName}` : ""}</p>
                  </div>
                  <div style={{ padding: "0 18px 14px", display: "flex", gap: 8 }}>
                    <button onClick={() => openEdit(it)} style={{ flex: 1, padding: "7px 0", borderRadius: 7, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#374151" }}>Edit</button>
                    {it.status === "archived" ? (
                      <button onClick={() => unarchive(it)} disabled={busyId === it.id} style={{ flex: 1, padding: "7px 0", borderRadius: 7, background: "#fff", border: "1px solid #e5e7eb", cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#374151", opacity: busyId === it.id ? 0.6 : 1 }}>
                        {busyId === it.id ? "…" : "Unarchive"}
                      </button>
                    ) : (
                      <button onClick={() => setArchiveTarget(it)} disabled={busyId === it.id} style={{ flex: 1, padding: "7px 0", borderRadius: 7, background: "#fff", border: "1px solid #fecaca", cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#b91c1c", opacity: busyId === it.id ? 0.6 : 1 }}>
                        Archive
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      {modal && (
        <div style={{ position: "fixed" as const, inset: 0, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(2px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setModal(false)}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 680, maxHeight: "92vh", display: "flex", flexDirection: "column" as const, boxShadow: "0 24px 70px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>

            <div style={{ padding: "20px 28px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111827" }}>{editId ? "Edit Itinerary" : "New Itinerary"}</h2>
                <p style={{ ...HINT, marginTop: 3 }}>A curated route through ordered venue stops — rendered as an editorial shelf on Discover.</p>
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
                  <label style={LABEL}>List type</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {LIST_TYPES.map(lt => (
                      <button
                        key={lt.value}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, listType: lt.value }))}
                        style={{
                          flex: 1, padding: "9px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600,
                          border: form.listType === lt.value ? "1px solid #111827" : "1px solid #e5e7eb",
                          background: form.listType === lt.value ? "#111827" : "#fff",
                          color: form.listType === lt.value ? "#fff" : "#374151",
                        }}
                      >
                        {lt.label}
                      </button>
                    ))}
                  </div>
                  <p style={HINT}>{LIST_TYPES.find(lt => lt.value === form.listType)?.hint}</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                  <label style={LABEL}>Title <span style={{ color: "#b91c1c" }}>*</span></label>
                  <input style={INPUT} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder={form.listType === "spot-list" ? "e.g. 5 spots in Buckhead" : "e.g. A Midtown night out"}/>
                </div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                  <label style={LABEL}>Neighborhood <span style={{ color: "#b91c1c" }}>*</span></label>
                  <input style={INPUT} value={form.neighborhood} onChange={e => setForm(f => ({ ...f, neighborhood: e.target.value }))} placeholder="e.g. Midtown"/>
                </div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                  <label style={LABEL}>Blurb (optional)</label>
                  <textarea style={{ ...INPUT, minHeight: 60, resize: "vertical" as const }} value={form.subtitle} onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} placeholder="Shown as &quot;THE NIGHT&quot; on the itinerary detail page"/>
                </div>
              </Section>

              <div style={{ height: 1, background: "#f3f4f6" }}/>

              <Section title="Hero Image" hint="Shown as the shelf card and the detail page hero.">
                <MediaManager
                  sections={[]}
                  value={form.media}
                  onChange={(media) => setForm(f => ({ ...f, media: media.length > 1 ? media.slice(-1) : media }))}
                  upload={{ endpoint: `/api/itineraries/${editId || pendingId}/upload`, accept: "image/*" }}
                />
              </Section>

              <div style={{ height: 1, background: "#f3f4f6" }}/>

              <Section title="Curation" hint="Attributes this list to the influencer/curator who made it. Optional — leave blank for a house-curated list.">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                    <label style={LABEL}>Curator name</label>
                    <input style={INPUT} value={form.authorName} onChange={e => setForm(f => ({ ...f, authorName: e.target.value }))} placeholder="e.g. Jarrod Knight"/>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                    <label style={LABEL}>Handle</label>
                    <input style={INPUT} value={form.authorHandle} onChange={e => setForm(f => ({ ...f, authorHandle: e.target.value }))} placeholder="@handle"/>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                  <label style={LABEL}>Curator photo</label>
                  <MediaManager
                    sections={[]}
                    value={form.authorPhotoMedia}
                    onChange={(media) => setForm(f => ({ ...f, authorPhotoMedia: media.length > 1 ? media.slice(-1) : media }))}
                    upload={{ endpoint: `/api/itineraries/${editId || pendingId}/upload`, accept: "image/*" }}
                  />
                </div>
              </Section>

              <div style={{ height: 1, background: "#f3f4f6" }}/>

              <Section title="Route stops" hint={form.listType === "spot-list" ? "Venues in this roundup. Each blurb is shown to guests." : "Ordered venue stops a guest visits in sequence. First is the route's starting point."}>
                <VenuePicker
                  venueId=""
                  placeholder="Search venues to add a stop..."
                  onChange={addStop}
                />
                {form.stops.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#9ca3af", margin: 0 }}>No stops yet — search above to add the first one.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                    {form.stops.map((s, i) => (
                      <div key={s.venueId} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 12, borderRadius: 10, border: "1px solid #e5e7eb" }}>
                        <div style={{ width: 26, height: 26, borderRadius: 13, background: STOP_COLORS[i % STOP_COLORS.length], color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>{i + 1}</div>
                        <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, gap: 6 }}>
                          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#111827" }}>{s.venueName}</p>
                          <input style={{ ...INPUT, fontSize: 13 }} value={s.note} onChange={e => setStopNote(i, e.target.value)} placeholder={form.listType === "spot-list" ? "Blurb (shown to guests)" : "Curator note (optional, not shown to guests)"}/>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column" as const, gap: 4, flexShrink: 0 }}>
                          <button type="button" disabled={i === 0} onClick={() => moveStop(i, -1)} title="Move up" aria-label="Move up" style={{ width: 24, height: 24, borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.35 : 1, fontSize: 12 }}>↑</button>
                          <button type="button" disabled={i === form.stops.length - 1} onClick={() => moveStop(i, 1)} title="Move down" aria-label="Move down" style={{ width: 24, height: 24, borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: i === form.stops.length - 1 ? "default" : "pointer", opacity: i === form.stops.length - 1 ? 0.35 : 1, fontSize: 12 }}>↓</button>
                          <button type="button" onClick={() => removeStop(i)} title="Remove" aria-label="Remove" style={{ width: 24, height: 24, borderRadius: 6, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", cursor: "pointer", fontSize: 11 }}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <div style={{ height: 1, background: "#f3f4f6" }}/>

              <Section title="Publishing">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                    <label style={LABEL}>Status</label>
                    <select style={INPUT} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                    <label style={LABEL}>Shelf order</label>
                    <input style={INPUT} type="number" value={form.order} onChange={e => setForm(f => ({ ...f, order: e.target.value }))}/>
                  </div>
                </div>
                <p style={HINT}>Shelf order is shared with neighborhood guides and photographer features on the Discover tab — lower numbers show first. Only "live" itineraries are visible to guests.</p>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                  <label style={LABEL}>Kicker</label>
                  <input style={INPUT} value={form.kicker} onChange={e => setForm(f => ({ ...f, kicker: e.target.value }))}/>
                </div>
              </Section>
            </div>

            <div style={{ padding: "14px 28px", borderTop: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 10 }}>
              <p style={{ ...HINT, flex: 1 }}>{stopSummary(form.stops.length, form.listType)}</p>
              <button onClick={() => setModal(false)} style={{ padding: "10px 20px", borderRadius: 8, background: "#fff", border: "1px solid #e5e7eb", cursor: "pointer", fontSize: 14, color: "#374151" }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ padding: "10px 24px", borderRadius: 8, background: "#111827", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
                {saving ? "Saving…" : editId ? "Save Changes" : "Create Itinerary"}
              </button>
            </div>
          </div>
        </div>
      )}

      {archiveTarget && (
        <ConfirmDialog
          message={`Archive "${archiveTarget.title}"? It will stop showing on the consumer app's Discover tab. You can unarchive it later.`}
          confirmLabel="Archive"
          onConfirm={() => archive(archiveTarget)}
          onCancel={() => setArchiveTarget(null)}
        />
      )}
    </>
  )
}

function stopSummary(n: number, listType: ListType): string {
  if (n === 0) return "Add at least one stop to save."
  if (listType === "spot-list") return `${n} venue${n === 1 ? "" : "s"} in this roundup.`
  return `${n} stop${n === 1 ? "" : "s"} in order, start to finish.`
}

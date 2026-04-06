"use client"
import DashboardLayout from "@/components/DashboardLayout"
import { useAuthContext } from "@/context/AuthContext"
import { useEffect, useState } from "react"
import { collection, onSnapshot } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useRouter } from "next/navigation"

type Gallery = {
  id: string
  eventTitle: string
  venueName: string
  photoCount: number
  status: string
  createdAt: any
}

export default function GalleriesPage() {
  const { user, loading, hasDashboardAccess } = useAuthContext()
  const router = useRouter()
  const [galleries, setGalleries] = useState<Gallery[]>([])
  const [dataLoading, setDataLoading] = useState(true)

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
  }, [loading, user, router])

  useEffect(() => {
    if (!user) return
    return onSnapshot(collection(db, "eventGalleries"), s => {
      const raw = s.docs.map(d => ({
        id: d.id,
        eventTitle: d.data().eventTitle || "Untitled",
        venueName: d.data().venueName || "",
        photoCount: d.data().photoCount || 0,
        status: d.data().status || "live",
        createdAt: d.data().createdAt,
      }))
      raw.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
      setGalleries(raw)
      setDataLoading(false)
    })
  }, [user])

  if (loading || !user || !hasDashboardAccess) return null

  return (
    <DashboardLayout>
      <div className="dash-page">

        {/* Header */}
        <div className="dash-header">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0 }}>Galleries</h1>
            <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>
              {galleries.length} {galleries.length === 1 ? "gallery" : "galleries"} from Wugi Lens
            </p>
          </div>
        </div>

        {/* Loading */}
        {dataLoading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: 20, height: 160, opacity: 0.5 }}/>
            ))}
          </div>
        )}

        {/* Empty */}
        {!dataLoading && galleries.length === 0 && (
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: "48px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📷</div>
            <p style={{ fontSize: 15, fontWeight: 600, color: "#374151", margin: "0 0 6px" }}>No galleries yet</p>
            <p style={{ fontSize: 14, color: "#9ca3af", margin: 0 }}>Galleries appear here after a photographer publishes from Wugi Lens</p>
          </div>
        )}

        {/* Card grid — works great on mobile and desktop */}
        {!dataLoading && galleries.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {galleries.map(g => {
              const isLive = g.status === "live"
              const date = g.createdAt?.toDate?.()?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) || ""
              return (
                <div key={g.id} style={{
                  background: "#fff", borderRadius: 16,
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                  overflow: "hidden",
                  display: "flex", flexDirection: "column",
                }}>
                  {/* Card header — colored band */}
                  <div style={{
                    background: isLive ? "linear-gradient(135deg,#064e3b,#065f46)" : "#374151",
                    padding: "18px 20px 16px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {g.eventTitle}
                        </p>
                        <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {g.venueName || "Unknown venue"}
                        </p>
                      </div>
                      <span style={{
                        flexShrink: 0,
                        padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                        background: isLive ? "rgba(74,222,128,0.2)" : "rgba(255,255,255,0.1)",
                        color: isLive ? "#4ade80" : "rgba(255,255,255,0.6)",
                        border: `1px solid ${isLive ? "rgba(74,222,128,0.4)" : "rgba(255,255,255,0.2)"}`,
                        letterSpacing: "0.5px",
                        textTransform: "uppercase" as const,
                      }}>
                        {g.status}
                      </span>
                    </div>
                  </div>

                  {/* Card body */}
                  <div style={{ padding: "16px 20px", flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>

                    {/* Stats row */}
                    <div style={{ display: "flex", gap: 16 }}>
                      <div>
                        <p style={{ margin: "0 0 2px", fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>Photos</p>
                        <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>{g.photoCount}</p>
                      </div>
                      {date && (
                        <div>
                          <p style={{ margin: "0 0 2px", fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>Date</p>
                          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#374151" }}>{date}</p>
                        </div>
                      )}
                    </div>

                    {/* Gallery ID */}
                    <div style={{ background: "#f9fafb", borderRadius: 8, padding: "8px 10px" }}>
                      <p style={{ margin: "0 0 2px", fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>Gallery ID</p>
                      <p style={{ margin: 0, fontSize: 11, color: "#6b7280", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.id}</p>
                    </div>

                    {/* View button — full width, easy to tap on mobile */}
                    <a
                      href={`https://wugi.us/gallery/${g.id}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                        padding: "10px 16px", borderRadius: 10,
                        background: isLive ? "#064e3b" : "#374151",
                        color: "#fff", textDecoration: "none",
                        fontSize: 14, fontWeight: 600,
                        marginTop: "auto",
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                      View on wugi.us
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}

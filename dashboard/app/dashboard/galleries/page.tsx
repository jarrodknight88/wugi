"use client"
import DashboardLayout from "@/components/DashboardLayout"
import { useAuthContext } from "@/context/AuthContext"
import { useEffect, useState } from "react"
import { collection, onSnapshot } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useRouter } from "next/navigation"
import Link from "next/link"

const CARD = { background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" }

type Gallery = { id: string; eventTitle: string; venueName: string; photoCount: number; status: string; photographerId: string }

export default function GalleriesPage() {
  const { user, loading } = useAuthContext()
  const router = useRouter()
  const [galleries, setGalleries] = useState<Gallery[]>([])

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [loading, user, router])

  useEffect(() => {
    if (!user) return
    return onSnapshot(collection(db, "eventGalleries"), s => {
      setGalleries(s.docs.map(d => ({ id: d.id, eventTitle: d.data().eventTitle || "Untitled", venueName: d.data().venueName || "", photoCount: d.data().photoCount || 0, status: d.data().status || "live", photographerId: d.data().photographerId || "" })))
    })
  }, [user])

  if (loading || !user) return null

  return (
    <DashboardLayout>
      <div style={{ padding: "32px 36px" }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0 }}>Galleries</h1>
          <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>{galleries.length} active galleries from Wugi Lens</p>
        </div>
        <div style={{ ...CARD, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                {["Event","Venue","Photos","Status","View"].map(h => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 13 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {galleries.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: "40px 16px", textAlign: "center", color: "#9ca3af" }}>No galleries yet</td></tr>
              ) : galleries.map((g, i) => (
                <tr key={g.id} style={{ borderBottom: i < galleries.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                  <td style={{ padding: "12px 16px", fontWeight: 600, color: "#111827" }}>{g.eventTitle}</td>
                  <td style={{ padding: "12px 16px", color: "#6b7280" }}>{g.venueName}</td>
                  <td style={{ padding: "12px 16px", color: "#374151", fontWeight: 600 }}>{g.photoCount}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: g.status === "live" ? "#dcfce7" : "#f3f4f6", color: g.status === "live" ? "#15803d" : "#6b7280" }}>{g.status}</span>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <a href={`https://wugi.us/gallery/${g.id}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#2a7a5a", textDecoration: "none", fontWeight: 500 }}>View →</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  )
}

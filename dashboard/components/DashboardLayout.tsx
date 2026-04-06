"use client"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { signOut } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { useAuthContext } from "@/context/AuthContext"
import { useState } from "react"

const NAV = [
  { href: "/dashboard",           label: "Overview",   icon: "◻" },
  { href: "/dashboard/venues",    label: "Venues",     icon: "⬡" },
  { href: "/dashboard/events",    label: "Events",     icon: "◈" },
  { href: "/dashboard/tickets",   label: "Tickets",    icon: "◇" },
  { href: "/dashboard/galleries", label: "Galleries",  icon: "▣" },
  { href: "/dashboard/users",     label: "Users",      icon: "◉" },
  { href: "/dashboard/audit",     label: "Audit Log",  icon: "≡" },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const { user } = useAuthContext()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    await signOut(auth)
    router.replace("/login")
  }

  return (
    <div className="flex min-h-screen" style={{ background: "#f0f2f5", fontFamily: "'Inter', sans-serif" }}>
      <aside className="flex flex-col sticky top-0 h-screen overflow-y-auto"
        style={{ width: 240, flexShrink: 0, background: "#111827" }}>
        <div style={{ padding: "24px 20px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ color: "#2a7a5a", fontSize: 22, fontWeight: 900, letterSpacing: -1 }}>wugi</div>
          <div style={{ color: "#4b5563", fontSize: 10, fontWeight: 700, letterSpacing: 2, marginTop: 2 }}>ADMIN PANEL</div>
        </div>
        <nav style={{ flex: 1, padding: "10px 8px" }}>
          {NAV.map(item => {
            const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href)
            return (
              <Link key={item.href} href={item.href}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
                  borderRadius: 8, marginBottom: 2, textDecoration: "none", fontSize: 14,
                  background: active ? "rgba(42,122,90,0.15)" : "transparent",
                  color: active ? "#4ade80" : "#9ca3af",
                  fontWeight: active ? 600 : 400,
                  borderLeft: active ? "2px solid #2a7a5a" : "2px solid transparent",
                }}>
                <span style={{ fontSize: 15, width: 20, textAlign: "center" }}>{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email}</div>
          <button onClick={handleLogout} disabled={loggingOut}
            style={{ width: "100%", padding: "8px 0", borderRadius: 8, fontSize: 13, cursor: "pointer",
              background: "rgba(255,255,255,0.04)", color: "#6b7280", border: "1px solid rgba(255,255,255,0.07)" }}>
            {loggingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </aside>
      <main style={{ flex: 1, minWidth: 0, overflowX: "hidden" }}>{children}</main>
    </div>
  )
}

"use client"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { signOut } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { useAuthContext } from "@/context/AuthContext"
import { useState, useEffect } from "react"

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
  const pathname   = usePathname()
  const router     = useRouter()
  const { user }   = useAuthContext()
  const [loggingOut, setLoggingOut] = useState(false)
  const [open, setOpen]             = useState(false)

  // Close sidebar on route change (mobile)
  useEffect(() => { setOpen(false) }, [pathname])

  // Lock body scroll when sidebar open on mobile
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [open])

  async function handleLogout() {
    setLoggingOut(true)
    await signOut(auth)
    router.replace("/login")
  }

  const sidebarContent = (
    <>
      {/* Logo */}
      <div style={{ padding: "24px 20px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ color: "#2a7a5a", fontSize: 22, fontWeight: 900, letterSpacing: -1 }}>wugi</div>
          <div style={{ color: "#4b5563", fontSize: 10, fontWeight: 700, letterSpacing: 2, marginTop: 2 }}>ADMIN PANEL</div>
        </div>
        {/* Close button — mobile only */}
        <button onClick={() => setOpen(false)} style={{ display: "none", background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 22, lineHeight: 1 }} className="sidebar-close">×</button>
      </div>
      {/* Nav */}
      <nav style={{ flex: 1, padding: "10px 8px", overflowY: "auto" }}>
        {NAV.map(item => {
          const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href)
          return (
            <Link key={item.href} href={item.href} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
              borderRadius: 8, marginBottom: 2, textDecoration: "none", fontSize: 14,
              background: active ? "rgba(42,122,90,0.15)" : "transparent",
              color: active ? "#4ade80" : "#9ca3af",
              fontWeight: active ? 600 : 400,
              borderLeft: active ? "2px solid #2a7a5a" : "2px solid transparent",
              transition: "all 0.15s",
            }}>
              <span style={{ fontSize: 15, width: 20, textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* User */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email}</div>
        <button onClick={handleLogout} disabled={loggingOut} style={{
          width: "100%", padding: "8px 0", borderRadius: 8, fontSize: 13, cursor: "pointer",
          background: "rgba(255,255,255,0.04)", color: "#6b7280", border: "1px solid rgba(255,255,255,0.07)",
        }}>
          {loggingOut ? "Signing out..." : "Sign out"}
        </button>
      </div>
    </>
  )

  return (
    <>
      <style>{`
        @media (max-width: 768px) {
          .sidebar-close { display: block !important; }
          .desktop-sidebar { display: none !important; }
          .mobile-topbar { display: flex !important; }
          .main-content { padding: 16px !important; }
        }
        @media (min-width: 769px) {
          .mobile-overlay { display: none !important; }
          .mobile-sidebar { display: none !important; }
          .mobile-topbar { display: none !important; }
        }
        * { box-sizing: border-box; }
        body { margin: 0; }
      `}</style>

      <div style={{ display: "flex", minHeight: "100vh", background: "#f0f2f5" }}>

        {/* ── Desktop sidebar (hidden on mobile) ── */}
        <aside className="desktop-sidebar" style={{
          width: 240, flexShrink: 0, background: "#111827",
          display: "flex", flexDirection: "column",
          position: "sticky", top: 0, height: "100vh", overflowY: "auto",
        }}>
          {sidebarContent}
        </aside>

        {/* ── Mobile overlay ── */}
        {open && (
          <div className="mobile-overlay" onClick={() => setOpen(false)} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 40,
          }}/>
        )}

        {/* ── Mobile slide-in sidebar ── */}
        <aside className="mobile-sidebar" style={{
          position: "fixed", top: 0, left: 0, bottom: 0, width: 260,
          background: "#111827", display: "flex", flexDirection: "column",
          zIndex: 50, transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.25s ease", overflowY: "auto",
        }}>
          {sidebarContent}
        </aside>

        {/* ── Main area ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

          {/* Mobile top bar */}
          <div className="mobile-topbar" style={{
            display: "none", alignItems: "center", justifyContent: "space-between",
            padding: "12px 16px", background: "#111827", position: "sticky", top: 0, zIndex: 30,
          }}>
            <button onClick={() => setOpen(true)} style={{
              background: "none", border: "none", color: "#9ca3af", cursor: "pointer",
              fontSize: 22, display: "flex", alignItems: "center", padding: 4,
            }}>☰</button>
            <div style={{ color: "#2a7a5a", fontSize: 18, fontWeight: 900, letterSpacing: -0.5 }}>wugi</div>
            <div style={{ width: 32 }}/>{/* spacer */}
          </div>

          {/* Page content */}
          <main className="main-content" style={{ flex: 1, padding: "32px 36px", minWidth: 0 }}>
            {children}
          </main>
        </div>
      </div>
    </>
  )
}

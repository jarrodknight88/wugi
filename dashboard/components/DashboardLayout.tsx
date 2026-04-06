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

const TOPBAR_H = 52 // px — fixed mobile topbar height

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const { user } = useAuthContext()
  const [loggingOut, setLoggingOut] = useState(false)
  const [open, setOpen]             = useState(false)

  useEffect(() => { setOpen(false) }, [pathname])

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden"
      document.body.style.position = "relative"
    } else {
      document.body.style.overflow = ""
      document.body.style.position = ""
    }
    return () => {
      document.body.style.overflow = ""
      document.body.style.position = ""
    }
  }, [open])

  async function handleLogout() {
    setLoggingOut(true)
    await signOut(auth)
    router.replace("/login")
  }

  const navLinks = (
    <nav style={{ flex: 1, padding: "10px 8px", overflowY: "auto" }}>
      {NAV.map(item => {
        const active = item.href === "/dashboard"
          ? pathname === item.href
          : pathname.startsWith(item.href)
        return (
          <Link key={item.href} href={item.href} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: 8, marginBottom: 2,
            textDecoration: "none", fontSize: 14,
            background: active ? "rgba(42,122,90,0.15)" : "transparent",
            color: active ? "#4ade80" : "#9ca3af",
            fontWeight: active ? 600 : 400,
            borderLeft: active ? "2px solid #2a7a5a" : "2px solid transparent",
          }}>
            <span style={{ fontSize: 15, width: 20, textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
            {item.label}
          </Link>
        )
      })}
    </nav>
  )

  const userFooter = (
    <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
      <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email}</div>
      <button onClick={handleLogout} disabled={loggingOut} style={{
        width: "100%", padding: "8px 0", borderRadius: 8, fontSize: 13,
        cursor: "pointer", background: "rgba(255,255,255,0.04)",
        color: "#6b7280", border: "1px solid rgba(255,255,255,0.07)",
      }}>
        {loggingOut ? "Signing out..." : "Sign out"}
      </button>
    </div>
  )

  return (
    <>
      <style>{`
        html, body { margin: 0; padding: 0; }
        *, *::before, *::after { box-sizing: border-box; }

        /* ── Mobile topbar: fixed, full width, never shifts ── */
        .wg-topbar {
          display: none;
          position: fixed;
          top: 0; left: 0; right: 0;
          height: ${TOPBAR_H}px;
          background: #111827;
          z-index: 50;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          /* Prevent any width calculation from causing shift */
          width: 100%;
          min-width: 0;
        }

        /* Spacer pushes content below fixed topbar on mobile */
        .wg-topbar-spacer {
          display: none;
          height: ${TOPBAR_H}px;
          flex-shrink: 0;
        }

        /* Desktop sidebar */
        .wg-sidebar {
          width: 240px;
          flex-shrink: 0;
          background: #111827;
          display: flex;
          flex-direction: column;
          position: sticky;
          top: 0;
          height: 100vh;
          overflow-y: auto;
        }

        /* Mobile sidebar: off-screen by default */
        .wg-drawer {
          display: none;
          position: fixed;
          top: 0; left: 0; bottom: 0;
          width: 260px;
          background: #111827;
          flex-direction: column;
          z-index: 60;
          transform: translateX(-100%);
          transition: transform 0.25s cubic-bezier(0.4,0,0.2,1);
          overflow-y: auto;
        }
        .wg-drawer.open { transform: translateX(0); }

        /* Overlay */
        .wg-overlay {
          display: none;
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          z-index: 55;
        }
        .wg-overlay.open { display: block; }

        /* Page content padding */
        .wg-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .dash-page { padding: 32px 36px; }

        @media (max-width: 768px) {
          .wg-sidebar   { display: none !important; }
          .wg-topbar    { display: flex; }
          .wg-topbar-spacer { display: block; }
          .wg-drawer    { display: flex; }
          .dash-page    { padding: 20px 16px; }

          .dash-stat-grid {
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 10px !important;
            margin-bottom: 20px !important;
          }
          .dash-table-wrap table { min-width: 560px; }
        }

        @media (min-width: 769px) {
          .wg-drawer { display: none !important; }
        }

        .dash-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 24px;
          gap: 12px;
          flex-wrap: wrap;
        }
        .dash-filters {
          display: flex;
          gap: 8px;
          margin-bottom: 16px;
          flex-wrap: wrap;
          align-items: center;
        }
        .dash-stat-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 16px;
          margin-bottom: 28px;
        }
        .dash-table-wrap {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          border-radius: 12px;
          border: 1px solid #e5e7eb;
          box-shadow: 0 1px 3px rgba(0,0,0,0.06);
          background: #fff;
        }
        .dash-table-wrap table {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
          min-width: 600px;
        }
        .dash-quick-actions {
          display: flex;
          gap: 10px;
          margin-bottom: 28px;
          flex-wrap: wrap;
        }
      `}</style>

      {/* ── Fixed mobile topbar ── */}
      <div className="wg-topbar">
        <button onClick={() => setOpen(o => !o)} style={{
          background: "none", border: "none", color: "#9ca3af",
          cursor: "pointer", fontSize: 24, lineHeight: 1,
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 36, height: 36, borderRadius: 6, flexShrink: 0,
        }}>☰</button>
        <div style={{ color: "#2a7a5a", fontSize: 20, fontWeight: 900, letterSpacing: -0.5 }}>wugi</div>
        <div style={{ width: 36 }} />
      </div>

      {/* ── Mobile overlay ── */}
      <div className={`wg-overlay${open ? " open" : ""}`} onClick={() => setOpen(false)} />

      {/* ── Mobile drawer ── */}
      <div className={`wg-drawer${open ? " open" : ""}`}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ color: "#2a7a5a", fontSize: 20, fontWeight: 900, letterSpacing: -1 }}>wugi</div>
            <div style={{ color: "#4b5563", fontSize: 10, fontWeight: 700, letterSpacing: 2 }}>ADMIN PANEL</div>
          </div>
          <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        {navLinks}
        {userFooter}
      </div>

      {/* ── Page wrapper ── */}
      <div style={{ display: "flex", minHeight: "100vh", background: "#f0f2f5" }}>

        {/* Desktop sidebar */}
        <aside className="wg-sidebar">
          <div style={{ padding: "24px 20px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
            <div style={{ color: "#2a7a5a", fontSize: 22, fontWeight: 900, letterSpacing: -1 }}>wugi</div>
            <div style={{ color: "#4b5563", fontSize: 10, fontWeight: 700, letterSpacing: 2, marginTop: 2 }}>ADMIN PANEL</div>
          </div>
          {navLinks}
          {userFooter}
        </aside>

        {/* Main area */}
        <div className="wg-main">
          {/* Spacer so content clears the fixed topbar on mobile */}
          <div className="wg-topbar-spacer" />
          <main style={{ flex: 1 }}>
            {children}
          </main>
        </div>
      </div>
    </>
  )
}

"use client"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { signOut } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { useAuthContext } from "@/context/AuthContext"
import { useState, useEffect } from "react"

// SVG icon components — clean, consistent, sidebar-sized
const Icon = {
  Overview: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  Venues: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18M6 21V7l6-4 6 4v14M9 21v-6h6v6"/>
    </svg>
  ),
  Events: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>
    </svg>
  ),
  Tickets: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 9a2 2 0 0 1 0-4V3h20v2a2 2 0 0 1 0 4v2a2 2 0 0 1 0 4v2H2v-2a2 2 0 0 1 0-4V9z"/>
      <line x1="9" y1="3" x2="9" y2="21" strokeDasharray="2 2"/>
    </svg>
  ),
  Galleries: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  ),
  Users: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  Series: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>
      <path d="M5 12h2m4 0h2m4 0h2"/>
    </svg>
  ),
  Audit: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
  ),
}

const NAV = [
  { href: "/dashboard",           label: "Overview",   Icon: Icon.Overview  },
  { href: "/dashboard/venues",    label: "Venues",     Icon: Icon.Venues    },
  { href: "/dashboard/events",    label: "Events",     Icon: Icon.Events    },
  { href: "/dashboard/tickets",   label: "Tickets",    Icon: Icon.Tickets   },
  { href: "/dashboard/series",    label: "Series",     Icon: Icon.Series    },
  { href: "/dashboard/galleries", label: "Galleries",  Icon: Icon.Galleries },
  { href: "/dashboard/users",     label: "Users",      Icon: Icon.Users     },
  { href: "/dashboard/audit",     label: "Audit Log",  Icon: Icon.Audit     },
]

const TOPBAR_H = 52 // px — fixed mobile topbar height

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const { user, isSuperAdmin, canManageUsers } = useAuthContext()
  const [loggingOut, setLoggingOut] = useState(false)
  const [open, setOpen]             = useState(false)

  const visibleNav = NAV.filter(item => {
    if (item.href === "/dashboard/users")  return canManageUsers
    if (item.href === "/dashboard/audit")  return isSuperAdmin
    return true
  })

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
      {visibleNav.map(item => {
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
            <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
              <item.Icon />
            </span>
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

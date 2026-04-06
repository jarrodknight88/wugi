"use client"
import { signOut } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { useRouter } from "next/navigation"

export default function UnauthorizedPage() {
  const router = useRouter()

  async function handleSignOut() {
    await signOut(auth)
    router.replace("/login")
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f0f2f5", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 420, padding: "0 16px", textAlign: "center" }}>
        <div style={{ color: "#2a7a5a", fontSize: 28, fontWeight: 900, letterSpacing: -1, marginBottom: 32 }}>wugi</div>
        <div style={{ background: "#fff", borderRadius: 16, padding: "32px 28px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", border: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111827", margin: "0 0 12px" }}>Access Denied</h1>
          <p style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.6, margin: "0 0 28px" }}>
            Your account doesn't have permission to access the admin dashboard.
            Contact a super admin if you think this is a mistake.
          </p>
          <button onClick={handleSignOut} style={{ width: "100%", padding: "11px", borderRadius: 8, background: "#111827", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
            Sign out and try another account
          </button>
        </div>
      </div>
    </main>
  )
}

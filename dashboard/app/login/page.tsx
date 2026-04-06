"use client"

import { FormEvent, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { signInWithEmailAndPassword } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { useAuthContext } from "@/context/AuthContext"

export default function LoginPage() {
  const router = useRouter()
  const { user, loading } = useAuthContext()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!loading && user) {
      router.replace("/dashboard")
    }
  }, [loading, router, user])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setIsSubmitting(true)
    try {
      await signInWithEmailAndPassword(auth, email, password)
      // DO NOT create or overwrite user doc here — roles are managed in the dashboard
      router.replace("/dashboard")
    } catch {
      setError("Invalid email or password.")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (loading) {
    return (
      <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f0f2f5" }}>
        <div style={{ color: "#6b7280", fontSize: 14 }}>Loading...</div>
      </main>
    )
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f0f2f5", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 400, padding: "0 16px" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ color: "#2a7a5a", fontSize: 28, fontWeight: 900, letterSpacing: -1 }}>wugi</div>
          <div style={{ color: "#9ca3af", fontSize: 12, fontWeight: 600, letterSpacing: 2, marginTop: 4 }}>ADMIN PANEL</div>
        </div>
        <form onSubmit={handleSubmit} style={{ background: "#fff", borderRadius: 16, padding: "32px 28px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", border: "1px solid #e5e7eb" }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111827", margin: "0 0 24px" }}>Sign in</h1>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", boxSizing: "border-box" as const }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} required
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", boxSizing: "border-box" as const }}
            />
          </div>

          {error && <p style={{ color: "#b91c1c", fontSize: 13, marginBottom: 16 }}>{error}</p>}

          <button type="submit" disabled={isSubmitting} style={{ width: "100%", padding: "11px", borderRadius: 8, background: "#2a7a5a", color: "#fff", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 600, opacity: isSubmitting ? 0.7 : 1 }}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  )
}

"use client"

import DashboardLayout from "@/components/DashboardLayout"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore"
import { createUserWithEmailAndPassword } from "firebase/auth"
import { auth, db } from "@/lib/firebase"
import { logAudit } from "@/lib/auditLog"
import { useAuthContext } from "@/context/AuthContext"


type UserItem = {
  id: string
  email: string
  role: string
  active: boolean
  createdAt: string
}

export default function UsersPage() {
  const router = useRouter()
  const { user, hasDashboardAccess, role, loading: authLoading } = useAuthContext()
  const isSuperAdmin = role === "super_admin"

  const [users, setUsers] = useState<UserItem[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [error, setError] = useState("")

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [newRole, setNewRole] = useState<"moderator" | "support">("moderator")
  const [creating, setCreating] = useState(false)

  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.replace("/login"); return }
    if (!hasDashboardAccess) router.replace("/unauthorized")
  }, [authLoading, user, hasDashboardAccess, router])

  useEffect(() => {
    if (!user) return

    async function loadUsers() {
      setLoadingUsers(true)
      setError("")
      try {
        const snapshot = await getDocs(collection(db, "users"))
        const items: UserItem[] = snapshot.docs.map((d) => {
          const data = d.data()
          return {
            id: d.id,
            email: typeof data.email === "string" ? data.email : "—",
            role: typeof data.role === "string" ? data.role : "unknown",
            active: data.active === true,
            createdAt:
              typeof data.createdAt === "string" ? data.createdAt : "—",
          }
        })
        setUsers(items)
      } catch {
        setError("Could not load users. Please try again.")
      } finally {
        setLoadingUsers(false)
      }
    }

    loadUsers()
  }, [user])

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError("")

    try {
      const credential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      )
      const now = new Date().toISOString()
      await setDoc(doc(db, "users", credential.user.uid), {
        email,
        role: newRole,
        active: true,
        createdAt: now,
      })

      if (user) {
        await logAudit({
          adminId: user.uid,
          adminEmail: user.email ?? "",
          action: "created_user",
          targetId: credential.user.uid,
          targetName: email,
        })
      }

      setUsers((prev) => [
        ...prev,
        {
          id: credential.user.uid,
          email,
          role: newRole,
          active: true,
          createdAt: now,
        },
      ])
      setEmail("")
      setPassword("")
    } catch {
      setError("Could not create user. Please try again.")
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(userId: string, currentlyActive: boolean) {
    setTogglingId(userId)
    setError("")
    try {
      await updateDoc(doc(db, "users", userId), {
        active: !currentlyActive,
      })

      const targetUser = users.find((u) => u.id === userId)
      if (user) {
        await logAudit({
          adminId: user.uid,
          adminEmail: user.email ?? "",
          action: currentlyActive ? "deactivated_user" : "activated_user",
          targetId: userId,
          targetName: targetUser?.email ?? userId,
        })
      }

      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, active: !currentlyActive } : u
        )
      )
    } catch {
      setError("Could not update user status. Please try again.")
    } finally {
      setTogglingId(null)
    }
  }

  async function changeRole(userId: string, nextRole: string) {
    setChangingRoleId(userId)
    setError("")
    try {
      await updateDoc(doc(db, "users", userId), { role: nextRole })
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: nextRole } : u))
      )
    } catch {
      setError("Could not change user role. Please try again.")
    } finally {
      setChangingRoleId(null)
    }
  }

  if (authLoading || !user || !hasDashboardAccess) return null

  return (
    <DashboardLayout>
      <div className="dash-page">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0 }}>User Management</h1>
            <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>Manage admin dashboard access.</p>
          </div>
        </div>

        {error && <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13, marginBottom: 16 }}>{error}</div>}

        {isSuperAdmin && (
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: "20px 24px", marginBottom: 20 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: "#111827", margin: "0 0 14px" }}>Create Admin User</h2>
            <form onSubmit={handleCreateUser} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input type="email" placeholder="Email" required value={email} onChange={e => setEmail(e.target.value)} style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", flex: 1, minWidth: 180 }}/>
              <input type="password" placeholder="Password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", flex: 1, minWidth: 140 }}/>
              <select value={newRole} onChange={e => setNewRole(e.target.value as "moderator"|"support")} style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none" }}>
                <option value="moderator">Moderator</option>
                <option value="support">Support</option>
              </select>
              <button type="submit" disabled={creating} style={{ padding: "9px 20px", borderRadius: 8, background: "#111827", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, opacity: creating ? 0.7 : 1 }}>
                {creating ? "Creating..." : "Create User"}
              </button>
            </form>
          </div>
        )}

        <div className="dash-table-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 600 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                {["Email","Role","Active","Created","Actions"].map(h => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 13 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingUsers ? (
                <tr><td colSpan={5} style={{ padding: "40px 16px", textAlign: "center", color: "#9ca3af" }}>Loading users...</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: "40px 16px", textAlign: "center", color: "#9ca3af" }}>No users found.</td></tr>
              ) : users.map((u, i) => {
                const isToggling = togglingId === u.id
                const isChangingRole = changingRoleId === u.id
                const isSelf = u.id === user?.uid
                const roleColors: Record<string, { bg: string; color: string }> = {
                  super_admin: { bg: "#fef3c7", color: "#92400e" },
                  moderator:   { bg: "#dbeafe", color: "#1e40af" },
                  support:     { bg: "#f3f4f6", color: "#6b7280" },
                }
                const rc = roleColors[u.role] || roleColors.support
                return (
                  <tr key={u.id} style={{ borderBottom: i < users.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                    <td style={{ padding: "12px 16px", color: "#111827", fontWeight: 500 }}>{u.email} {isSelf && <span style={{ fontSize: 11, color: "#9ca3af" }}>(you)</span>}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: rc.bg, color: rc.color }}>{u.role}</span>
                    </td>
                    <td style={{ padding: "12px 16px", color: u.active ? "#15803d" : "#9ca3af" }}>{u.active ? "Active" : "Inactive"}</td>
                    <td style={{ padding: "12px 16px", color: "#9ca3af", fontSize: 13 }}>{u.createdAt}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        {isSuperAdmin && !isSelf && (
                          <button onClick={() => toggleActive(u.id, u.active)} disabled={isToggling} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, border: "none", cursor: "pointer", fontWeight: 600, background: u.active ? "#fee2e2" : "#dcfce7", color: u.active ? "#b91c1c" : "#15803d" }}>
                            {isToggling ? "..." : u.active ? "Deactivate" : "Activate"}
                          </button>
                        )}
                        {isSuperAdmin && !isSelf && (u.role === "moderator" || u.role === "support") && (
                          <select value={u.role} disabled={isChangingRole} onChange={e => changeRole(u.id, e.target.value)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12 }}>
                            <option value="moderator">Moderator</option>
                            <option value="support">Support</option>
                          </select>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  )
}

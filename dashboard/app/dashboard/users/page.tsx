"use client"

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
import { useAuth } from "@/hooks/useAuth"
import { useDashboardAccess } from "@/hooks/useDashboardAccess"

type UserItem = {
  id: string
  email: string
  role: string
  active: boolean
  createdAt: string
}

export default function UsersPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { hasDashboardAccess, hasUserDocument, role, loading: accessLoading } =
    useDashboardAccess()
  const isSuperAdmin = role === "super_admin"

  const [users, setUsers] = useState<UserItem[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [error, setError] = useState("")

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [newRole, setNewRole] = useState<"moderator" | "support">("moderator")
  const [creating, setCreating] = useState(false)

  const [togglingId, setTogglingId] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login")
    }
  }, [authLoading, router, user])

  useEffect(() => {
    if (!accessLoading && hasUserDocument && !hasDashboardAccess) {
      router.replace("/unauthorized")
    }
  }, [accessLoading, hasDashboardAccess, hasUserDocument, router])

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

  if (authLoading || accessLoading) {
    return <main className="min-h-screen p-6">Checking authentication...</main>
  }

  if (!user || !hasDashboardAccess) {
    return null
  }

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">User Management</h1>
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded border border-neutral-300 px-3 py-2 text-sm"
          >
            Back to Dashboard
          </button>
        </div>

        <p className="text-sm text-neutral-600">
          View and manage dashboard user accounts.
        </p>

        {error ? (
          <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
        ) : null}

        {isSuperAdmin && (
          <form
            onSubmit={handleCreateUser}
            className="rounded border border-neutral-300 p-4 space-y-3"
          >
            <h2 className="text-sm font-semibold">Create User</h2>
            <div className="flex flex-wrap gap-3">
              <input
                type="email"
                placeholder="Email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded border border-neutral-300 px-3 py-2 text-sm"
              />
              <input
                type="password"
                placeholder="Password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded border border-neutral-300 px-3 py-2 text-sm"
              />
              <select
                value={newRole}
                onChange={(e) =>
                  setNewRole(e.target.value as "moderator" | "support")
                }
                className="rounded border border-neutral-300 px-3 py-2 text-sm"
              >
                <option value="moderator">Moderator</option>
                <option value="support">Support</option>
              </select>
              <button
                type="submit"
                disabled={creating}
                className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-60"
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </form>
        )}

        {loadingUsers ? (
          <div className="rounded border border-neutral-300 p-4">
            Loading users...
          </div>
        ) : users.length === 0 ? (
          <div className="rounded border border-neutral-300 p-4">
            No users found.
          </div>
        ) : (
          <div className="overflow-x-auto rounded border border-neutral-300">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-300 bg-neutral-50">
                <tr>
                  <th className="px-4 py-3 font-semibold text-neutral-700">
                    Email
                  </th>
                  <th className="px-4 py-3 font-semibold text-neutral-700">
                    Role
                  </th>
                  <th className="px-4 py-3 font-semibold text-neutral-700">
                    Active
                  </th>
                  <th className="px-4 py-3 font-semibold text-neutral-700">
                    Created At
                  </th>
                  <th className="px-4 py-3 font-semibold text-neutral-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isToggling = togglingId === u.id
                  return (
                    <tr
                      key={u.id}
                      className="border-b border-neutral-200 last:border-b-0"
                    >
                      <td className="px-4 py-3">{u.email}</td>
                      <td className="px-4 py-3">{u.role}</td>
                      <td className="px-4 py-3">
                        {u.active ? "Yes" : "No"}
                      </td>
                      <td className="px-4 py-3">{u.createdAt}</td>
                      <td className="px-4 py-3">
                        {isSuperAdmin && (
                          <button
                            onClick={() => toggleActive(u.id, u.active)}
                            disabled={isToggling}
                            className={`rounded px-3 py-1 text-sm text-white disabled:opacity-60 ${
                              u.active ? "bg-red-600" : "bg-green-600"
                            }`}
                          >
                            {isToggling
                              ? "Saving..."
                              : u.active
                                ? "Deactivate"
                                : "Activate"}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}

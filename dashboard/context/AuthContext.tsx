"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { onAuthStateChanged, type User } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { auth, db } from "@/lib/firebase"

const DASHBOARD_ROLES = ["super_admin", "moderator", "support"]

type AuthContextType = {
  user: User | null
  role: string | null
  hasUserDocument: boolean
  hasDashboardAccess: boolean
  loading: boolean
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  hasUserDocument: false,
  hasDashboardAccess: false,
  loading: true,
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [hasUserDocument, setHasUserDocument] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser)

      if (!nextUser) {
        setRole(null)
        setHasUserDocument(false)
        setLoading(false)
        return
      }

      try {
        const snap = await getDoc(doc(db, "users", nextUser.uid))
        if (snap.exists()) {
          setHasUserDocument(true)
          setRole((snap.data().role as string) ?? null)
        } else {
          setHasUserDocument(false)
          setRole(null)
        }
      } catch {
        setHasUserDocument(false)
        setRole(null)
      } finally {
        setLoading(false)
      }
    })

    return unsubscribe
  }, [])

  const hasDashboardAccess =
    !loading &&
    hasUserDocument &&
    role !== null &&
    DASHBOARD_ROLES.includes(role)

  return (
    <AuthContext.Provider
      value={{ user, role, hasUserDocument, hasDashboardAccess, loading }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuthContext() {
  return useContext(AuthContext)
}

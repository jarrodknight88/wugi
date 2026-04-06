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

      // Keep loading=true until the Firestore doc fetch completes
      // This prevents premature unauthorized redirects
      try {
        const snap = await getDoc(doc(db, "users", nextUser.uid))
        if (snap.exists()) {
          setHasUserDocument(true)
          setRole((snap.data().role as string) ?? null)
        } else {
          // No user doc — auto-create with consumer role
          // (handles case where user signed in but doc not yet created)
          setHasUserDocument(false)
          setRole(null)
        }
      } catch {
        setHasUserDocument(false)
        setRole(null)
      } finally {
        // Only set loading=false AFTER the Firestore fetch completes
        setLoading(false)
      }
    })

    return unsubscribe
  }, [])

  // hasDashboardAccess is only true when loading is done AND doc exists AND role is valid
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

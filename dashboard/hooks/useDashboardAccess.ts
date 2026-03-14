"use client"

import { useEffect, useState } from "react"
import { doc, getDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuth } from "@/hooks/useAuth"

const DASHBOARD_ROLES = ["super_admin", "moderator", "support"]

type UseDashboardAccessResult = {
  hasDashboardAccess: boolean
  hasUserDocument: boolean
  role: string | null
  loading: boolean
}

export function useDashboardAccess(): UseDashboardAccessResult {
  const { user, loading: authLoading } = useAuth()
  const [role, setRole] = useState<string | null>(null)
  const [hasUserDocument, setHasUserDocument] = useState(false)
  const [roleLoading, setRoleLoading] = useState(true)

  useEffect(() => {
    if (authLoading) {
      return
    }

    if (!user) {
      setRole(null)
      setHasUserDocument(false)
      setRoleLoading(false)
      return
    }

    let cancelled = false

    async function fetchRole() {
      setRoleLoading(true)
      try {
        const snap = await getDoc(doc(db, "users", user!.uid))
        if (cancelled) return
        if (snap.exists()) {
          setHasUserDocument(true)
          setRole((snap.data().role as string) ?? null)
        } else {
          setHasUserDocument(false)
          setRole(null)
        }
      } catch {
        if (cancelled) return
        setHasUserDocument(false)
        setRole(null)
      } finally {
        if (!cancelled) {
          setRoleLoading(false)
        }
      }
    }

    fetchRole()

    return () => {
      cancelled = true
    }
  }, [authLoading, user])

  const loading = authLoading || roleLoading

  return {
    hasDashboardAccess: !loading && hasUserDocument && role !== null && DASHBOARD_ROLES.includes(role),
    hasUserDocument: !loading && hasUserDocument,
    role: !loading ? role : null,
    loading,
  }
}

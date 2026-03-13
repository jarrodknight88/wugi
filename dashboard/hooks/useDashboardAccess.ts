"use client"

import { useEffect, useState } from "react"
import { doc, onSnapshot } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuth } from "@/hooks/useAuth"

const DASHBOARD_ROLES = ["super_admin", "moderator", "support"]

type UseDashboardAccessResult = {
  hasDashboardAccess: boolean
  loading: boolean
}

export function useDashboardAccess(): UseDashboardAccessResult {
  const { user, loading: authLoading } = useAuth()
  const [role, setRole] = useState<string | null>(null)
  const [roleLoading, setRoleLoading] = useState(true)

  useEffect(() => {
    if (authLoading) {
      return
    }

    if (!user) {
      setRole(null)
      setRoleLoading(false)
      return
    }

    setRoleLoading(true)

    const unsubscribe = onSnapshot(doc(db, "users", user.uid), (snap) => {
      if (snap.exists()) {
        setRole((snap.data().role as string) ?? null)
      } else {
        setRole(null)
      }
      setRoleLoading(false)
    })

    return unsubscribe
  }, [authLoading, user])

  const loading = authLoading || roleLoading

  return {
    hasDashboardAccess: !loading && role !== null && DASHBOARD_ROLES.includes(role),
    loading,
  }
}

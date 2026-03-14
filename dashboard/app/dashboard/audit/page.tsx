"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuth } from "@/hooks/useAuth"
import { useDashboardAccess } from "@/hooks/useDashboardAccess"

type AuditEntry = {
  id: string
  adminEmail: string
  action: string
  targetName: string
  timestamp: string
}

export default function AuditLogsPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { hasDashboardAccess, hasUserDocument, loading: accessLoading } =
    useDashboardAccess()
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [loadingLogs, setLoadingLogs] = useState(true)
  const [error, setError] = useState("")

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

    setLoadingLogs(true)
    setError("")

    const logsQuery = query(
      collection(db, "auditLogs"),
      orderBy("timestamp", "desc"),
      limit(100)
    )

    const unsubscribe = onSnapshot(
      logsQuery,
      (snapshot) => {
        const entries: AuditEntry[] = snapshot.docs.map((d) => {
          const data = d.data()
          let timestamp = "—"
          if (data.timestamp?.toDate) {
            timestamp = data.timestamp.toDate().toLocaleString()
          } else if (typeof data.timestamp === "string") {
            timestamp = data.timestamp
          }
          return {
            id: d.id,
            adminEmail:
              typeof data.adminEmail === "string" ? data.adminEmail : "—",
            action: typeof data.action === "string" ? data.action : "—",
            targetName:
              typeof data.targetName === "string" ? data.targetName : "—",
            timestamp,
          }
        })
        setLogs(entries)
        setLoadingLogs(false)
      },
      () => {
        setError("Could not load audit logs. Please try again.")
        setLoadingLogs(false)
      }
    )

    return unsubscribe
  }, [user])

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
          <h1 className="text-2xl font-bold">Audit Logs</h1>
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded border border-neutral-300 px-3 py-2 text-sm"
          >
            Back to Dashboard
          </button>
        </div>

        <p className="text-sm text-neutral-600">
          Recent admin actions (last 100 entries).
        </p>

        {error ? (
          <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
        ) : null}

        {loadingLogs ? (
          <div className="rounded border border-neutral-300 p-4">
            Loading audit logs...
          </div>
        ) : logs.length === 0 ? (
          <div className="rounded border border-neutral-300 p-4">
            No audit logs yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded border border-neutral-300">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-300 bg-neutral-50">
                <tr>
                  <th className="px-4 py-3 font-semibold text-neutral-700">
                    Date/Time
                  </th>
                  <th className="px-4 py-3 font-semibold text-neutral-700">
                    Admin
                  </th>
                  <th className="px-4 py-3 font-semibold text-neutral-700">
                    Action
                  </th>
                  <th className="px-4 py-3 font-semibold text-neutral-700">
                    Target
                  </th>
                </tr>
              </thead>
              <tbody>
                {logs.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-neutral-200 last:border-b-0"
                  >
                    <td className="px-4 py-3">{entry.timestamp}</td>
                    <td className="px-4 py-3">{entry.adminEmail}</td>
                    <td className="px-4 py-3">{entry.action}</td>
                    <td className="px-4 py-3">{entry.targetName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}

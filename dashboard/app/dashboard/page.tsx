"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { signOut } from "firebase/auth"
import { collection, onSnapshot } from "firebase/firestore"
import { auth, db } from "@/lib/firebase"
import { useAuth } from "@/hooks/useAuth"
import { useDashboardAccess } from "@/hooks/useDashboardAccess"

type VenueStatus = "pending" | "approved" | "rejected"

type Analytics = {
  total: number
  pending: number
  approved: number
  rejected: number
}

export default function DashboardPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { hasDashboardAccess, hasUserDocument, loading: accessLoading } = useDashboardAccess()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [analytics, setAnalytics] = useState<Analytics>({
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
  })
  const [loadingAnalytics, setLoadingAnalytics] = useState(true)
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
    if (!user) {
      return
    }

    setLoadingAnalytics(true)
    setError("")

    const unsubscribe = onSnapshot(
      collection(db, "venues"),
      (snapshot) => {
        const nextAnalytics: Analytics = {
          total: snapshot.size,
          pending: 0,
          approved: 0,
          rejected: 0,
        }

        snapshot.forEach((venueDoc) => {
          const data = venueDoc.data()
          const status = data.status as VenueStatus | undefined

          if (status === "pending") {
            nextAnalytics.pending += 1
          } else if (status === "approved") {
            nextAnalytics.approved += 1
          } else if (status === "rejected") {
            nextAnalytics.rejected += 1
          }
        })

        setAnalytics(nextAnalytics)
        setLoadingAnalytics(false)
      },
      () => {
        setError("Could not load dashboard analytics. Please try again.")
        setLoadingAnalytics(false)
      }
    )

    return unsubscribe
  }, [user])

  async function handleLogout() {
    setIsLoggingOut(true)
    await signOut(auth)
    router.replace("/login")
  }

  if (authLoading) {
    return <main className="min-h-screen p-6">Checking authentication...</main>
  }

  if (!user) {
    return null
  }

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Wugi Admin Dashboard</h1>
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="rounded border border-neutral-300 px-4 py-2 text-sm"
          >
            {isLoggingOut ? "Logging out..." : "Logout"}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-neutral-600">
            Overview of venue approvals in Firestore.
          </p>
          <div className="flex gap-2">
            <Link
              href="/dashboard/venues"
              className="rounded bg-black px-4 py-2 text-sm text-white"
            >
              Manage Venue Queue
            </Link>
            <Link
              href="/dashboard/events"
              className="rounded border border-neutral-300 px-4 py-2 text-sm"
            >
              Manage Event Queue
            </Link>
            <Link
              href="/dashboard/users"
              className="rounded border border-neutral-300 px-4 py-2 text-sm"
            >
              Manage Users
            </Link>
          </div>
        </div>

        {error ? (
          <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
        ) : null}

        {loadingAnalytics ? (
          <div className="rounded border border-neutral-300 p-4">
            Loading analytics...
          </div>
        ) : (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <article className="rounded border border-neutral-300 p-4">
              <p className="text-sm text-neutral-600">Total Venues</p>
              <p className="mt-2 text-3xl font-semibold">{analytics.total}</p>
            </article>

            <article className="rounded border border-neutral-300 p-4">
              <p className="text-sm text-neutral-600">Pending Venues</p>
              <p className="mt-2 text-3xl font-semibold">{analytics.pending}</p>
            </article>

            <article className="rounded border border-neutral-300 p-4">
              <p className="text-sm text-neutral-600">Approved Venues</p>
              <p className="mt-2 text-3xl font-semibold">{analytics.approved}</p>
            </article>

            <article className="rounded border border-neutral-300 p-4">
              <p className="text-sm text-neutral-600">Rejected Venues</p>
              <p className="mt-2 text-3xl font-semibold">{analytics.rejected}</p>
            </article>
          </section>
        )}
      </div>
    </main>
  )
}

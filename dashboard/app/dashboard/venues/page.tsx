"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuth } from "@/hooks/useAuth"

type VenueStatus = "pending" | "approved" | "rejected"

type Venue = {
  id: string
  name: string
  city: string
  category: string
  status: VenueStatus
}

export default function VenuesApprovalPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [venues, setVenues] = useState<Venue[]>([])
  const [loadingVenues, setLoadingVenues] = useState(true)
  const [activeVenueId, setActiveVenueId] = useState<string | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login")
    }
  }, [authLoading, router, user])

  useEffect(() => {
    if (!user) {
      return
    }

    setLoadingVenues(true)
    setError("")

    const venuesQuery = query(
      collection(db, "venues"),
      where("status", "==", "pending")
    )

    const unsubscribe = onSnapshot(
      venuesQuery,
      (snapshot) => {
        const pendingVenues: Venue[] = snapshot.docs.map((venueDoc) => {
          const data = venueDoc.data()

          return {
            id: venueDoc.id,
            name: typeof data.name === "string" ? data.name : "Unnamed venue",
            city: typeof data.city === "string" ? data.city : "Unknown city",
            category:
              typeof data.category === "string"
                ? data.category
                : "Uncategorized",
            status: "pending",
          }
        })

        setVenues(pendingVenues)
        setLoadingVenues(false)
      },
      () => {
        setError("Could not load pending venues. Please try again.")
        setLoadingVenues(false)
      }
    )

    return unsubscribe
  }, [user])

  async function updateVenueStatus(venueId: string, nextStatus: VenueStatus) {
    setActiveVenueId(venueId)
    setError("")

    try {
      const venueRef = doc(db, "venues", venueId)
      await updateDoc(venueRef, { status: nextStatus })

      // Remove the item from the queue once it is approved/rejected.
      setVenues((currentVenues) =>
        currentVenues.filter((venue) => venue.id !== venueId)
      )
    } catch {
      setError("Could not update venue status. Please try again.")
    } finally {
      setActiveVenueId(null)
    }
  }

  if (authLoading) {
    return <main className="min-h-screen p-6">Checking authentication...</main>
  }

  if (!user) {
    return null
  }

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Venue Approval Queue</h1>
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded border border-neutral-300 px-3 py-2 text-sm"
          >
            Back to Dashboard
          </button>
        </div>

        <p className="text-sm text-neutral-600">
          Review new venues and approve or reject them.
        </p>

        {error ? <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

        {loadingVenues ? (
          <div className="rounded border border-neutral-300 p-4">
            Loading pending venues...
          </div>
        ) : venues.length === 0 ? (
          <div className="rounded border border-neutral-300 p-4">
            No pending venues right now.
          </div>
        ) : (
          <ul className="space-y-3">
            {venues.map((venue) => {
              const isUpdating = activeVenueId === venue.id

              return (
                <li
                  key={venue.id}
                  className="rounded border border-neutral-300 p-4"
                >
                  <div className="grid gap-2 text-sm md:grid-cols-4">
                    <p>
                      <span className="font-semibold">Name:</span> {venue.name}
                    </p>
                    <p>
                      <span className="font-semibold">City:</span> {venue.city}
                    </p>
                    <p>
                      <span className="font-semibold">Category:</span>{" "}
                      {venue.category}
                    </p>
                    <p>
                      <span className="font-semibold">Status:</span>{" "}
                      {venue.status}
                    </p>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => updateVenueStatus(venue.id, "approved")}
                      disabled={isUpdating}
                      className="rounded bg-green-600 px-3 py-2 text-sm text-white disabled:opacity-60"
                    >
                      {isUpdating ? "Saving..." : "Approve"}
                    </button>
                    <button
                      onClick={() => updateVenueStatus(venue.id, "rejected")}
                      disabled={isUpdating}
                      className="rounded bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-60"
                    >
                      {isUpdating ? "Saving..." : "Reject"}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </main>
  )
}

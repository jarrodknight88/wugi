"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuth } from "@/hooks/useAuth"

type EventStatus = "pending" | "approved" | "rejected"

type EventItem = {
  id: string
  title: string
  venueName: string
  date: string
  status: EventStatus
}

export default function EventsApprovalPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [events, setEvents] = useState<EventItem[]>([])
  const [loadingEvents, setLoadingEvents] = useState(true)
  const [activeEventId, setActiveEventId] = useState<string | null>(null)
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

    async function loadPendingEvents() {
      setLoadingEvents(true)
      setError("")

      try {
        const eventsQuery = query(
          collection(db, "events"),
          where("status", "==", "pending")
        )
        const snapshot = await getDocs(eventsQuery)

        const pendingEvents: EventItem[] = snapshot.docs.map((eventDoc) => {
          const data = eventDoc.data()

          return {
            id: eventDoc.id,
            title: typeof data.title === "string" ? data.title : "Untitled event",
            venueName:
              typeof data.venueName === "string"
                ? data.venueName
                : "Unknown venue",
            date: typeof data.date === "string" ? data.date : "No date set",
            status: "pending",
          }
        })

        setEvents(pendingEvents)
      } catch {
        setError("Could not load pending events. Please try again.")
      } finally {
        setLoadingEvents(false)
      }
    }

    loadPendingEvents()
  }, [user])

  async function updateEventStatus(eventId: string, nextStatus: EventStatus) {
    setActiveEventId(eventId)
    setError("")

    try {
      const eventRef = doc(db, "events", eventId)
      await updateDoc(eventRef, { status: nextStatus })

      // Remove processed events from the pending queue list.
      setEvents((currentEvents) =>
        currentEvents.filter((event) => event.id !== eventId)
      )
    } catch {
      setError("Could not update event status. Please try again.")
    } finally {
      setActiveEventId(null)
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
          <h1 className="text-2xl font-bold">Event Approval Queue</h1>
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded border border-neutral-300 px-3 py-2 text-sm"
          >
            Back to Dashboard
          </button>
        </div>

        <p className="text-sm text-neutral-600">
          Review pending events and approve or reject them.
        </p>

        {error ? (
          <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
        ) : null}

        {loadingEvents ? (
          <div className="rounded border border-neutral-300 p-4">
            Loading pending events...
          </div>
        ) : events.length === 0 ? (
          <div className="rounded border border-neutral-300 p-4">
            No pending events right now.
          </div>
        ) : (
          <ul className="space-y-3">
            {events.map((event) => {
              const isUpdating = activeEventId === event.id

              return (
                <li key={event.id} className="rounded border border-neutral-300 p-4">
                  <div className="grid gap-2 text-sm md:grid-cols-4">
                    <p>
                      <span className="font-semibold">Title:</span> {event.title}
                    </p>
                    <p>
                      <span className="font-semibold">Venue:</span> {event.venueName}
                    </p>
                    <p>
                      <span className="font-semibold">Date:</span> {event.date}
                    </p>
                    <p>
                      <span className="font-semibold">Status:</span> {event.status}
                    </p>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => updateEventStatus(event.id, "approved")}
                      disabled={isUpdating}
                      className="rounded bg-green-600 px-3 py-2 text-sm text-white disabled:opacity-60"
                    >
                      {isUpdating ? "Saving..." : "Approve"}
                    </button>
                    <button
                      onClick={() => updateEventStatus(event.id, "rejected")}
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

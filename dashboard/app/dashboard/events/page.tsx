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
import { logAudit } from "@/lib/auditLog"
import { useAuth } from "@/hooks/useAuth"
import { useDashboardAccess } from "@/hooks/useDashboardAccess"

type EventStatus = "pending" | "approved" | "rejected"

type EventItem = {
  id: string
  title: string
  venueId: string
  startTime: string
  status: EventStatus
}

export default function EventsApprovalPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { hasDashboardAccess, hasUserDocument, loading: accessLoading } = useDashboardAccess()
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
    if (!accessLoading && hasUserDocument && !hasDashboardAccess) {
      router.replace("/unauthorized")
    }
  }, [accessLoading, hasDashboardAccess, hasUserDocument, router])

  useEffect(() => {
    if (!user) {
      return
    }

    setLoadingEvents(true)
    setError("")

    const eventsQuery = query(
      collection(db, "events"),
      where("status", "==", "pending")
    )

    const unsubscribe = onSnapshot(
      eventsQuery,
      (snapshot) => {
        const pendingEvents: EventItem[] = snapshot.docs.map((eventDoc) => {
          const data = eventDoc.data()

          return {
            id: eventDoc.id,
            title: typeof data.title === "string" ? data.title : "Untitled event",
            venueId:
              typeof data.venueId === "string"
                ? data.venueId
                : "Unknown venue",
            startTime: typeof data.startTime === "string" ? data.startTime : "No date set",
            status: "pending",
          }
        })

        setEvents(pendingEvents)
        setLoadingEvents(false)
      },
      () => {
        setError("Could not load pending events. Please try again.")
        setLoadingEvents(false)
      }
    )

    return unsubscribe
  }, [user])

  async function updateEventStatus(eventId: string, nextStatus: EventStatus) {
    setActiveEventId(eventId)
    setError("")

    try {
      const eventRef = doc(db, "events", eventId)
      await updateDoc(eventRef, { status: nextStatus })

      const event = events.find((e) => e.id === eventId)
      if (user) {
        await logAudit({
          adminId: user.uid,
          adminEmail: user.email ?? "",
          action: nextStatus === "approved" ? "approved_event" : "rejected_event",
          targetId: eventId,
          targetName: event?.title ?? eventId,
        })
      }

      setEvents((currentEvents) =>
        currentEvents.filter((e) => e.id !== eventId)
      )
    } catch {
      setError("Could not update event status. Please try again.")
    } finally {
      setActiveEventId(null)
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
          {!loadingEvents && (
            <span className="ml-1 font-semibold">
              {events.length} pending
            </span>
          )}
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
          <div className="overflow-x-auto rounded border border-neutral-300">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-300 bg-neutral-50">
                <tr>
                  <th className="px-4 py-3 font-semibold text-neutral-700">Title</th>
                  <th className="px-4 py-3 font-semibold text-neutral-700">Venue</th>
                  <th className="px-4 py-3 font-semibold text-neutral-700">Date</th>
                  <th className="px-4 py-3 font-semibold text-neutral-700">Status</th>
                  <th className="px-4 py-3 font-semibold text-neutral-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => {
                  const isUpdating = activeEventId === event.id

                  return (
                    <tr
                      key={event.id}
                      className="border-b border-neutral-200 last:border-b-0"
                    >
                      <td className="px-4 py-3">{event.title}</td>
                      <td className="px-4 py-3">{event.venueId}</td>
                      <td className="px-4 py-3">{event.startTime}</td>
                      <td className="px-4 py-3">{event.status}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => updateEventStatus(event.id, "approved")}
                            disabled={isUpdating}
                            className="rounded bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-60"
                          >
                            {isUpdating ? "Saving..." : "Approve"}
                          </button>
                          <button
                            onClick={() => updateEventStatus(event.id, "rejected")}
                            disabled={isUpdating}
                            className="rounded bg-red-600 px-3 py-1 text-sm text-white disabled:opacity-60"
                          >
                            {isUpdating ? "Saving..." : "Reject"}
                          </button>
                        </div>
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

// ─────────────────────────────────────────────────────────────────────
// useVenueFilter — central hook for scoped data access
// Returns filtered query constraints based on the user's role.
// Super admins see everything. Venue/event admins see their scope.
// ─────────────────────────────────────────────────────────────────────
"use client"
import { useAuthContext } from "@/context/AuthContext"

export function useVenueFilter() {
  const { isSuperAdmin, isVenueAdmin, isVenueStaff, isEventAdmin, isEventStaff, profile } = useAuthContext()

  const isSuper  = isSuperAdmin
  const isVenue  = isVenueAdmin || isVenueStaff
  const isEvent  = isEventAdmin || isEventStaff

  return {
    // For venue list queries: null = show all, array = show these only
    venueIds:   isSuper ? null : profile.venueIds,
    // For event list queries: null = show all, array = filter by venueId or eventIds
    eventIds:   isSuper ? null : isEvent && !isVenue ? profile.eventIds : null,
    // Scoped to venues even for event roles (events belong to their venues)
    scopeVenueIds: isSuper ? null : profile.venueIds,
    // Can this user see a specific venueId?
    canAccessVenue: (venueId: string) => {
      if (isSuper) return true
      return profile.venueIds.includes(venueId)
    },
    // Can this user see a specific eventId?
    canAccessEvent: (eventId: string, venueId?: string) => {
      if (isSuper) return true
      if (isVenue && venueId && profile.venueIds.includes(venueId)) return true
      if (isEvent && profile.eventIds.includes(eventId)) return true
      return false
    },
  }
}

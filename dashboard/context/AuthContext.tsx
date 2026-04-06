"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { onAuthStateChanged, type User } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { auth, db } from "@/lib/firebase"

// All roles that can access the dashboard at all
const DASHBOARD_ROLES = [
  "super_admin",
  "moderator",
  "support",
  "venue_admin",
  "venue_staff",
  "event_admin",
  "event_staff",
]

// Roles with full admin write access (not scoped)
const SUPER_ROLES = ["super_admin", "moderator", "support"]

export type WugiRole =
  | "super_admin" | "moderator" | "support"
  | "venue_admin" | "venue_staff"
  | "event_admin" | "event_staff"
  | null

export type UserProfile = {
  role: WugiRole
  venueIds: string[]      // venues this user can access
  eventIds: string[]      // events this user can access (event_admin/staff)
  tableAccess: boolean    // can manage tables (event_admin opt-in)
}

type AuthContextType = {
  user:              User | null
  profile:           UserProfile
  role:              WugiRole
  loading:           boolean
  hasUserDocument:   boolean
  hasDashboardAccess:boolean
  isSuperAdmin:      boolean
  isVenueAdmin:      boolean
  isVenueStaff:      boolean
  isEventAdmin:      boolean
  isEventStaff:      boolean
  canWrite:          boolean   // can create/edit (not staff roles)
  canManageTables:   boolean
  canManageUsers:    boolean   // super_admin only
}

const DEFAULT_PROFILE: UserProfile = {
  role: null, venueIds: [], eventIds: [], tableAccess: false,
}

const AuthContext = createContext<AuthContextType>({
  user: null, profile: DEFAULT_PROFILE, role: null,
  loading: true, hasUserDocument: false, hasDashboardAccess: false,
  isSuperAdmin: false, isVenueAdmin: false, isVenueStaff: false,
  isEventAdmin: false, isEventStaff: false,
  canWrite: false, canManageTables: false, canManageUsers: false,
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,            setUser]            = useState<User | null>(null)
  const [profile,         setProfile]         = useState<UserProfile>(DEFAULT_PROFILE)
  const [hasUserDocument, setHasUserDocument] = useState(false)
  const [loading,         setLoading]         = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser)
      if (!nextUser) {
        setProfile(DEFAULT_PROFILE)
        setHasUserDocument(false)
        setLoading(false)
        return
      }
      try {
        const snap = await getDoc(doc(db, "users", nextUser.uid))
        if (snap.exists()) {
          const d = snap.data()
          setHasUserDocument(true)
          setProfile({
            role:        (d.role as WugiRole) ?? null,
            venueIds:    Array.isArray(d.venueIds)  ? d.venueIds  : [],
            eventIds:    Array.isArray(d.eventIds)  ? d.eventIds  : [],
            tableAccess: d.tableAccess === true,
          })
        } else {
          setHasUserDocument(false)
          setProfile(DEFAULT_PROFILE)
        }
      } catch {
        setHasUserDocument(false)
        setProfile(DEFAULT_PROFILE)
      } finally {
        setLoading(false)
      }
    })
    return unsub
  }, [])

  const role            = profile.role
  const hasDashboardAccess = !loading && hasUserDocument && role !== null && DASHBOARD_ROLES.includes(role)
  const isSuperAdmin    = SUPER_ROLES.includes(role ?? "")
  const isVenueAdmin    = role === "venue_admin"
  const isVenueStaff    = role === "venue_staff"
  const isEventAdmin    = role === "event_admin"
  const isEventStaff    = role === "event_staff"
  const canWrite        = isSuperAdmin || isVenueAdmin || isEventAdmin
  const canManageTables = isSuperAdmin || isVenueAdmin || (isEventAdmin && profile.tableAccess)
  const canManageUsers  = isSuperAdmin

  return (
    <AuthContext.Provider value={{
      user, profile, role, loading, hasUserDocument, hasDashboardAccess,
      isSuperAdmin, isVenueAdmin, isVenueStaff, isEventAdmin, isEventStaff,
      canWrite, canManageTables, canManageUsers,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuthContext() {
  return useContext(AuthContext)
}

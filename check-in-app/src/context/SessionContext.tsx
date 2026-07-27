import React, { createContext, useContext, useState, ReactNode } from 'react';

// Mirrors WugiRole in dashboard/context/AuthContext.tsx and the role
// provisioned via dashboard/app/dashboard/users/page.tsx.
export type StaffRole =
  | 'super_admin' | 'moderator' | 'support'
  | 'venue_admin' | 'venue_staff'
  | 'event_admin' | 'event_staff';

export interface EventSession {
  eventId: string;
  eventName: string;
  venueName: string;
  venueId: string;
  date: string;
  role: StaffRole;
  // Deprecated — PIN auth is retired (docs/DOOR-REDESIGN-SPEC.md §1), always ''.
  // Kept only because PaymentScreen/ScannerScreen/TransactionsScreen/IDScanScreen
  // still read session.pin for cancelDoorSale/refundDoorSale and audit stamps;
  // moving those off PIN-based staff verification is a separate follow-up task.
  pin: string;
  isSuperAdmin?: boolean;  // role === 'super_admin' — sees all venues, bypasses geofence
}

interface SessionContextType {
  session: EventSession | null;
  setSession: (s: EventSession | null) => void;
  clearSession: () => void;
}

const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<EventSession | null>(null);

  const clearSession = () => setSession(null);

  return (
    <SessionContext.Provider value={{ session, setSession, clearSession }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}

import React, { createContext, useContext, useState, ReactNode } from 'react';

export type StaffRole = 'door' | 'manager' | 'super_admin';

export interface EventSession {
  eventId: string;
  eventName: string;
  venueName: string;
  venueId: string;
  venueLatitude: number;
  venueLongitude: number;
  date: string;
  role: StaffRole;
  pin: string;
  isSuperAdmin?: boolean;  // bypasses geofence and works across all events
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

// ─────────────────────────────────────────────────────────────────────
// TerminalContext — Stripe Terminal (Tap to Pay) SDK manager
// Apple Tap to Pay entitlement approved — fully enabled
// ─────────────────────────────────────────────────────────────────────
import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import {
  StripeTerminalProvider,
  useStripeTerminal,
  Reader,
} from '@stripe/stripe-terminal-react-native';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';

// Cache locationId per venueId for connectReader calls
const locationIdCache: Record<string, string> = {};

async function fetchConnectionToken(venueId: string): Promise<string> {
  const fn = httpsCallable(getFunctions(), 'createTerminalConnectionToken');
  const result = await fn({ venueId });
  const data = result.data as any;
  // Cache locationId so connectReader can use it
  if (data.locationId) locationIdCache[venueId] = data.locationId;
  return data.secret;
}

interface TerminalContextType {
  isReady: boolean;
  isConnecting: boolean;
  connectReader: (venueId: string) => Promise<void>;
  disconnectReader: () => Promise<void>;
  error: string | null;
}

const TerminalContext = createContext<TerminalContextType | null>(null);

function TerminalInner({ children }: { children: ReactNode }) {
  const { connectLocalMobileReader, disconnectReader, connectedReader } = useStripeTerminal();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectReader = useCallback(async (venueId: string) => {
    if (connectedReader) return;
    setIsConnecting(true); setError(null);
    try {
      // Fetch a connection token first to populate locationId cache if needed
      if (!locationIdCache[venueId]) {
        await fetchConnectionToken(venueId);
      }
      const locationId = locationIdCache[venueId];
      const connectParams: any = { locationId };
      const { error: connErr } = await connectLocalMobileReader(connectParams);
      if (connErr) setError(connErr.message);
    } catch (e: any) {
      setError(e.message || 'Failed to connect reader');
    } finally { setIsConnecting(false); }
  }, [connectedReader, connectLocalMobileReader]);

  const disconnect = useCallback(async () => {
    await disconnectReader();
  }, [disconnectReader]);

  return (
    <TerminalContext.Provider value={{
      isReady: !!connectedReader,
      isConnecting,
      connectReader,
      disconnectReader: disconnect,
      error,
    }}>
      {children}
    </TerminalContext.Provider>
  );
}

export function TerminalProvider({ children, venueId }: { children: ReactNode; venueId: string }) {
  const tokenProvider = useCallback(() => fetchConnectionToken(venueId), [venueId]);
  return (
    <StripeTerminalProvider logLevel="verbose" tokenProvider={tokenProvider}>
      <TerminalInner>{children}</TerminalInner>
    </StripeTerminalProvider>
  );
}

export function useTerminal() {
  const ctx = useContext(TerminalContext);
  if (!ctx) {
    // Safe stub when used outside provider (shouldn't happen with TAP_TO_PAY_ENABLED=true)
    return {
      isReady: false, isConnecting: false,
      connectReader: async (_: string) => {},
      disconnectReader: async () => {},
      error: null,
    };
  }
  return ctx;
}

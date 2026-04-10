// ─────────────────────────────────────────────────────────────────────
// TerminalContext — Stripe Terminal (Tap to Pay) SDK manager
// Apple Tap to Pay entitlement approved — fully enabled
// ─────────────────────────────────────────────────────────────────────
import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import {
  StripeTerminalProvider,
  useStripeTerminal,
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

function TerminalInner({ children, venueId }: { children: ReactNode; venueId: string }) {
  const { connectLocalMobileReader, disconnectReader, connectedReader } = useStripeTerminal();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectReader = useCallback(async (vid: string) => {
    if (connectedReader) return;
    setIsConnecting(true); setError(null);
    try {
      if (!locationIdCache[vid]) {
        await fetchConnectionToken(vid);
      }
      const locationId = locationIdCache[vid];
      if (!locationId) {
        setError('Could not retrieve terminal location. Check venue setup.');
        return;
      }
      const connectParams: any = { locationId };
      const { error: connErr } = await connectLocalMobileReader(connectParams);
      if (connErr) {
        console.warn('Terminal connect error:', connErr.message, connErr.code);
        setError(connErr.message);
      }
    } catch (e: any) {
      console.warn('Terminal connect exception:', e.message);
      setError(e.message || 'Failed to connect reader');
    } finally { setIsConnecting(false); }
  }, [connectedReader, connectLocalMobileReader]);

  // Auto-connect on mount
  React.useEffect(() => {
    if (venueId && venueId !== '__super_admin__') {
      connectReader(venueId);
    }
  }, [venueId]);

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
      <TerminalInner venueId={venueId}>{children}</TerminalInner>
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

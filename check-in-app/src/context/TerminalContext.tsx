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

// Always fetch fresh — no caching so live/test mode switches work correctly
async function fetchConnectionToken(venueId: string): Promise<string> {
  const fn = httpsCallable(getFunctions(), 'createTerminalConnectionToken');
  const result = await fn({ venueId });
  const data = result.data as any;
  return data.secret;
}

// Store locationId per session (not module level)
let _locationId: string = '';

async function fetchConnectionTokenAndLocation(venueId: string): Promise<{ secret: string; locationId: string }> {
  const fn = httpsCallable(getFunctions(), 'createTerminalConnectionToken');
  const result = await fn({ venueId });
  const data = result.data as any;
  if (data.locationId) _locationId = data.locationId;
  return { secret: data.secret, locationId: data.locationId || '' };
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
  const { easyConnect, disconnectReader, connectedReader, initialize } = useStripeTerminal();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectReader = useCallback(async (vid: string) => {
    if (connectedReader) return;
    setIsConnecting(true); setError(null);
    try {
      const { locationId } = await fetchConnectionTokenAndLocation(vid);
      if (!locationId) {
        setError('Could not retrieve terminal location. Check venue setup.');
        return;
      }
      const { error: connErr } = await easyConnect({
        discoveryMethod: 'tapToPay',
        locationId,
      });
      if (connErr) {
        console.warn('Terminal connect error:', connErr.message, connErr.code);
        setError(connErr.message);
      }
    } catch (e: any) {
      console.warn('Terminal connect exception:', e.message);
      setError(e.message || 'Failed to connect reader');
    } finally { setIsConnecting(false); }
  }, [connectedReader, easyConnect]);

  // Initialize SDK then auto-connect
  React.useEffect(() => {
    if (!venueId || venueId === '__super_admin__') return;
    let cancelled = false;
    async function initAndConnect() {
      try {
        await initialize();
        if (!cancelled) await connectReader(venueId);
      } catch (e: any) {
        console.warn('Terminal init error:', e.message);
      }
    }
    initAndConnect();
    return () => { cancelled = true; };
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
  const tokenProvider = useCallback(() => fetchConnectionToken(venueId), [venueId]); // SDK calls this for auth
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

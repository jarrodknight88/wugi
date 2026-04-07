// ─────────────────────────────────────────────────────────────────────
// TerminalContext — Stripe Terminal (Tap to Pay) SDK manager
// DISABLED until Apple approves the Tap to Pay entitlement.
// When enabled: flip TAP_TO_PAY_ENABLED = true in App.tsx,
// add back the entitlement + plugin in app.json, and rebuild.
// ─────────────────────────────────────────────────────────────────────
import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';

// ── Token fetch ───────────────────────────────────────────────────────
async function fetchConnectionToken(venueId: string): Promise<string> {
  const fn = httpsCallable(getFunctions(), 'createTerminalConnectionToken');
  const result = await fn({ venueId });
  return (result.data as any).secret;
}

// ── Context shape ─────────────────────────────────────────────────────
interface TerminalContextType {
  isReady: boolean;
  isConnecting: boolean;
  connectReader: (venueId: string) => Promise<void>;
  disconnectReader: () => Promise<void>;
  error: string | null;
}

const TerminalContext = createContext<TerminalContextType | null>(null);

// ── Stub inner component (no Stripe SDK imported here) ────────────────
// Full implementation is in TerminalContextFull.tsx — only loaded when
// TAP_TO_PAY_ENABLED = true and the native plugin is active.
function TerminalInner({ children }: { children: ReactNode }) {
  const [isConnecting] = useState(false);
  const [error] = useState<string | null>(null);

  const connectReader = useCallback(async (_venueId: string) => {
    console.log('[TerminalContext] Tap to Pay not yet enabled');
  }, []);

  const disconnectReader = useCallback(async () => {}, []);

  return (
    <TerminalContext.Provider value={{
      isReady: false,
      isConnecting,
      connectReader,
      disconnectReader,
      error,
    }}>
      {children}
    </TerminalContext.Provider>
  );
}

// ── Provider ──────────────────────────────────────────────────────────
export function TerminalProvider({
  children,
  venueId,
}: {
  children: ReactNode;
  venueId: string;
}) {
  // When Tap to Pay is enabled, this will wrap with StripeTerminalProvider.
  // For now, just renders a stub context.
  return <TerminalInner>{children}</TerminalInner>;
}

// ── Hook ──────────────────────────────────────────────────────────────
export function useTerminal() {
  const ctx = useContext(TerminalContext);
  // Returns a safe no-op stub when used outside TerminalProvider
  // (i.e. when TAP_TO_PAY_ENABLED = false and no provider is mounted)
  if (!ctx) {
    return {
      isReady: false,
      isConnecting: false,
      connectReader: async (_venueId: string) => {},
      disconnectReader: async () => {},
      error: null,
    };
  }
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────
// Wugi — useLiveSubscription
// VENUE-DATA-07 Deliverable E.3
//
// Generic Firestore onSnapshot wrapper for transactional screens. Mounts
// a listener on focus/mount, tears it down on unmount. Use this — NOT
// React Query — for any data where staleness can break correctness:
//   - passes/{passId}            (user pass status, transfer state)
//   - users/{uid}/passes         (My Passes screen list)
//   - orders/{orderId}           (order/payment in flight)
//   - events/{eventId}.tableInventory (live ticketing inventory)
//   - venues/{id}/photos         (Wugi Lens user-generated content)
//   - any Wugi Door scan/session data
//
// Catalog metadata (venue cards, event listings, vibes) goes through
// useCatalogQueries instead — see Deliverable E.6 in the ticket.
// ─────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import {
  getFirestore,
  doc as fsDoc,
  collection as fsCollection,
  query as fsQuery,
  onSnapshot,
  type FirebaseFirestoreTypes,
} from '@react-native-firebase/firestore';

const db = getFirestore();

export type LiveSubscriptionResult<T> = {
  data:    T | null;
  loading: boolean;
  error:   Error | null;
};

// ── Single document subscription ─────────────────────────────────────
// Pass null/undefined path to disable (skips listener entirely).
export function useLiveDoc<T = FirebaseFirestoreTypes.DocumentData>(
  path: string | null | undefined
): LiveSubscriptionResult<T> {
  const [state, setState] = useState<LiveSubscriptionResult<T>>({
    data: null, loading: !!path, error: null,
  });
  // Track the path-of-record so a re-render with a stale closure can't
  // reset state mid-subscription.
  const activePathRef = useRef<string | null | undefined>(path);

  useEffect(() => {
    activePathRef.current = path;
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));

    const segments = path.split('/').filter(Boolean);
    if (segments.length < 2 || segments.length % 2 !== 0) {
      setState({ data: null, loading: false, error: new Error(`useLiveDoc: invalid doc path "${path}"`) });
      return;
    }
    const ref = fsDoc(db, segments[0], ...segments.slice(1));
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (activePathRef.current !== path) return; // stale event after unsub
        if (!snap.exists()) {
          setState({ data: null, loading: false, error: null });
          return;
        }
        setState({
          data: { id: snap.id, ...snap.data() } as T,
          loading: false,
          error: null,
        });
      },
      (err) => {
        if (activePathRef.current !== path) return;
        console.log('useLiveDoc onSnapshot error:', path, err);
        setState({ data: null, loading: false, error: err as Error });
      }
    );

    return () => { activePathRef.current = null; unsub(); };
  }, [path]);

  return state;
}

// ── Collection subscription (with optional query constraints) ────────
// constraints is an array built by the caller via firestore where()/orderBy().
// Passing null path disables.
export function useLiveCollection<T = FirebaseFirestoreTypes.DocumentData>(
  path: string | null | undefined,
  constraints: any[] = []
): LiveSubscriptionResult<T[]> {
  const [state, setState] = useState<LiveSubscriptionResult<T[]>>({
    data: null, loading: !!path, error: null,
  });
  // Stringify constraints into the dep array so changes re-subscribe
  const constraintsKey = constraints.length;

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));

    const segments = path.split('/').filter(Boolean);
    if (segments.length < 1 || segments.length % 2 !== 1) {
      setState({ data: null, loading: false, error: new Error(`useLiveCollection: invalid collection path "${path}"`) });
      return;
    }
    const colRef = fsCollection(db, segments[0], ...segments.slice(1));
    const ref = constraints.length ? fsQuery(colRef, ...constraints) : colRef;

    let cancelled = false;
    const unsub = onSnapshot(
      ref,
      (snap: any) => {
        if (cancelled) return;
        const list = snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as T));
        setState({ data: list, loading: false, error: null });
      },
      (err) => {
        if (cancelled) return;
        console.log('useLiveCollection onSnapshot error:', path, err);
        setState({ data: null, loading: false, error: err as Error });
      }
    );

    return () => { cancelled = true; unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, constraintsKey]);

  return state;
}

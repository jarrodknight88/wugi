import React, { useEffect, useState, useCallback, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  View, Text, StyleSheet, ActivityIndicator, Alert, Platform, TouchableOpacity,
} from 'react-native';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { SessionProvider, useSession, EventSession, StaffRole } from './src/context/SessionContext';
import SignInScreen from './src/screens/SignInScreen';
import VenueSelectScreen, { Venue } from './src/screens/VenueSelectScreen';
import ShiftConfirmScreen from './src/screens/ShiftConfirmScreen';
import MainTabs from './src/screens/MainTabs';
import { COLORS } from './src/constants/colors';

const TAP_TO_PAY_ENABLED = true;

// Roles that see every venue instead of only users/{uid}.venueIds — "the
// exception, not the rule" (docs/DOOR-REDESIGN-SPEC.md §3). Moderator gets
// the same venue picker reach as super_admin, but only super_admin flips
// EventSession.isSuperAdmin (that flag additionally drives the org-wide
// aggregate dashboard/scan views elsewhere).
const GLOBAL_VENUE_ROLES = new Set<StaffRole>(['super_admin', 'moderator']);
const KNOWN_ROLES = new Set<StaffRole>([
  'super_admin', 'moderator', 'support', 'venue_admin', 'venue_staff', 'event_admin', 'event_staff',
]);

interface StaffProfile {
  role: StaffRole;
  venueIds: string[];
}

interface ResolvedEvent {
  id: string;
  name: string;
  date: string;
  time: string;
}

function venueDocToOption(id: string, data: any): Venue {
  return { id, name: data.name || 'Unnamed venue', secondaryLine: data.neighborhood || '' };
}

async function fetchAllVenues(): Promise<Venue[]> {
  const snap = await firestore().collection('venues').get();
  return snap.docs
    .map(d => venueDocToOption(d.id, d.data()))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Firestore 'in' queries cap at 10 values on this SDK — chunk defensively
// since a venue_admin/venue_staff account can be assigned more than that.
async function fetchVenuesByIds(ids: string[]): Promise<Venue[]> {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
  const snaps = await Promise.all(
    chunks.map(chunk =>
      firestore().collection('venues').where(firestore.FieldPath.documentId(), 'in', chunk).get()
    )
  );
  return snaps
    .flatMap(snap => snap.docs.map(d => venueDocToOption(d.id, d.data())))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Best-effort "tonight's event" for a venue. There is no reliable, universal
// date format across events (docs/DOOR-REDESIGN-SPEC.md — some events carry
// only a display `date` string, format varies by writer) and the schema does
// not prevent more than one ticketed event at a venue on the same night, so
// this mirrors the hasTickets-based single-event resolution already used by
// SuperAdminEventSelector (retired by this change) and VenueScreen.tsx in
// mobile-app: take the ticketed event nearest to now, first match on a tie.
// Venues with a genuine same-night double-header are not disambiguated.
async function resolveVenueEvent(venueId: string): Promise<ResolvedEvent | null> {
  const snap = await firestore()
    .collection('events')
    .where('venueId', '==', venueId)
    .where('hasTickets', '==', true)
    .get();
  if (snap.empty) return null;

  let best: { id: string; data: any; sortTime: number } | null = null;
  for (const doc of snap.docs) {
    const data = doc.data();
    const parsed = data.date ? new Date(data.date).getTime() : NaN;
    const sortTime = Number.isNaN(parsed) ? Infinity : parsed;
    if (!best || sortTime < best.sortTime) best = { id: doc.id, data, sortTime };
  }
  if (!best) return null;
  return {
    id: best.id,
    name: best.data.title || best.data.name || 'Untitled Event',
    date: best.data.date || '',
    time: best.data.time || '',
  };
}

async function fetchStaffProfile(uid: string): Promise<StaffProfile | null> {
  const snap = await firestore().collection('users').doc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data() as any;
  if (data.active === false) return null;
  const role: StaffRole = data.role;
  if (!KNOWN_ROLES.has(role)) return null;
  return { role, venueIds: Array.isArray(data.venueIds) ? data.venueIds : [] };
}

function LoadingView({ label }: { label: string }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={COLORS.brand} size="large" />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

// Auth is real now (email/password), so `auth().signOut()` here is a genuine
// account sign-out — unlike the retired PIN flow, this drops the user all
// the way back to SignInScreen, not just to venue selection.
function AccessDeniedView({ message }: { message: string }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.wordmark}>wugi</Text>
      <Text style={styles.errorText}>{message}</Text>
      <TouchableOpacity style={styles.retryButton} onPress={() => auth().signOut()} activeOpacity={0.8}>
        <Text style={styles.retryButtonText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

type Step =
  | { kind: 'loadingProfile' }
  | { kind: 'accessDenied'; message: string }
  | { kind: 'venueSelect'; venues: Venue[]; role: StaffRole }
  | { kind: 'resolvingEvent'; venue: Venue; role: StaffRole }
  | { kind: 'noEventAtVenue'; venue: Venue; role: StaffRole; venues: Venue[] }
  | { kind: 'shiftConfirm'; venue: Venue; event: ResolvedEvent; role: StaffRole; venues: Venue[] };

interface PreSessionFlowProps {
  user: FirebaseAuthTypes.User;
  lastVenueId: string | null;
  onShiftConfirmed: (venueId: string) => void;
}

function PreSessionFlow({ user, lastVenueId, onShiftConfirmed }: PreSessionFlowProps) {
  const { setSession } = useSession();
  const [step, setStep] = useState<Step>({ kind: 'loadingProfile' });

  const loadVenues = useCallback(async () => {
    setStep({ kind: 'loadingProfile' });
    const profile = await fetchStaffProfile(user.uid).catch(() => null);
    if (!profile) {
      setStep({ kind: 'accessDenied', message: "Your account isn't set up for Door yet. Contact your manager." });
      return;
    }
    const venues = GLOBAL_VENUE_ROLES.has(profile.role)
      ? await fetchAllVenues().catch(() => [])
      : await fetchVenuesByIds(profile.venueIds).catch(() => []);
    setStep({ kind: 'venueSelect', venues, role: profile.role });
  }, [user.uid]);

  useEffect(() => { loadVenues(); }, [loadVenues]);

  async function handlePickVenue(venue: Venue, role: StaffRole, venues: Venue[]) {
    setStep({ kind: 'resolvingEvent', venue, role });
    const event = await resolveVenueEvent(venue.id).catch(() => null);
    if (!event) {
      setStep({ kind: 'noEventAtVenue', venue, role, venues });
      return;
    }
    setStep({ kind: 'shiftConfirm', venue, event, role, venues });
  }

  function handleConfirmShift(venue: Venue, event: ResolvedEvent, role: StaffRole) {
    onShiftConfirmed(venue.id);
    const session: EventSession = {
      eventId: event.id,
      eventName: event.name,
      venueName: venue.name,
      venueId: venue.id,
      date: event.date,
      role,
      pin: '',
      isSuperAdmin: role === 'super_admin',
    };
    setSession(session);
  }

  switch (step.kind) {
    case 'loadingProfile':
      return <LoadingView label="Loading your account…" />;
    case 'accessDenied':
      return <AccessDeniedView message={step.message} />;
    case 'venueSelect':
      return (
        <VenueSelectScreen
          venues={step.venues}
          onPick={venue => handlePickVenue(venue, step.role, step.venues)}
          onBack={() => auth().signOut()}
        />
      );
    case 'resolvingEvent':
      return <LoadingView label={`Finding tonight's event at ${step.venue.name}…`} />;
    case 'noEventAtVenue':
      return (
        <View style={styles.centered}>
          <Text style={styles.wordmark}>wugi</Text>
          <Text style={styles.errorText}>No ticketed event tonight at {step.venue.name}.</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => setStep({ kind: 'venueSelect', venues: step.venues, role: step.role })}
            activeOpacity={0.8}>
            <Text style={styles.retryButtonText}>Choose a different venue</Text>
          </TouchableOpacity>
        </View>
      );
    case 'shiftConfirm':
      return (
        <ShiftConfirmScreen
          venue={step.venue}
          returning={step.venue.id === lastVenueId}
          shiftLabel={`${step.event.name}${step.event.date ? ' · ' + step.event.date : ''}${step.event.time ? ' · ' + step.event.time : ''}`}
          onConfirm={() => handleConfirmShift(step.venue, step.event, step.role)}
          onSwitch={() => setStep({ kind: 'venueSelect', venues: step.venues, role: step.role })}
        />
      );
  }
}

function handleSignIn(email: string, password: string, setSigningIn: (b: boolean) => void) {
  setSigningIn(true);
  auth()
    .signInWithEmailAndPassword(email, password)
    .catch((e: any) => {
      Alert.alert('Sign-in failed', e?.message || 'Check your email and password and try again.');
    })
    .finally(() => setSigningIn(false));
}

function handleForgotPassword() {
  if (Platform.OS !== 'ios') {
    Alert.alert('Forgot password?', 'Contact your manager to reset your password.');
    return;
  }
  Alert.prompt(
    'Reset password',
    "Enter your email and we'll send a reset link.",
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send',
        onPress: (email?: string) => {
          if (!email) return;
          auth()
            .sendPasswordResetEmail(email.trim())
            .then(() => Alert.alert('Check your email', 'If an account exists for that email, a reset link is on its way.'))
            .catch(() => Alert.alert('Error', 'Could not send reset email.'));
        },
      },
    ],
    'plain-text'
  );
}

function RootNavigator({ user }: { user: FirebaseAuthTypes.User | null | undefined }) {
  const { session } = useSession();
  const [signingIn, setSigningIn] = useState(false);
  // Lives here, not in PreSessionFlow, so it survives PreSessionFlow
  // unmounting/remounting across a full session cycle (e.g. DashboardScreen's
  // End Session clears the session and drops back to venue select).
  const lastVenueIdRef = useRef<string | null>(null);

  if (user === undefined) return <LoadingView label="Loading…" />;

  if (user === null) {
    if (signingIn) return <LoadingView label="Signing in…" />;
    return (
      <SignInScreen
        onSignIn={(email, password) => handleSignIn(email, password, setSigningIn)}
        onForgotPassword={handleForgotPassword}
      />
    );
  }

  if (!session) {
    return (
      <PreSessionFlow
        user={user}
        lastVenueId={lastVenueIdRef.current}
        onShiftConfirmed={venueId => { lastVenueIdRef.current = venueId; }}
      />
    );
  }

  if (TAP_TO_PAY_ENABLED) {
    const { TerminalProvider } = require('./src/context/TerminalContext');
    return (
      <TerminalProvider venueId={session.venueId}>
        <MainTabs />
      </TerminalProvider>
    );
  }

  return <MainTabs />;
}

export default function App() {
  const [user, setUser] = useState<FirebaseAuthTypes.User | null | undefined>(undefined);

  useEffect(() => auth().onAuthStateChanged(setUser), []);

  return (
    <SessionProvider>
      <StatusBar style="light" />
      <RootNavigator user={user} />
    </SessionProvider>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1, backgroundColor: COLORS.bg,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32,
  },
  wordmark: {
    fontSize: 42, fontWeight: '900', color: COLORS.brand,
    letterSpacing: 2, marginBottom: 24,
  },
  loadingText: { color: COLORS.subtext, fontSize: 14, marginTop: 12 },
  errorText: { color: COLORS.text, fontSize: 15, textAlign: 'center', marginBottom: 24 },
  retryButton: {
    backgroundColor: COLORS.brand, borderRadius: 12,
    paddingVertical: 13, paddingHorizontal: 24,
  },
  retryButtonText: { color: COLORS.onBrand, fontSize: 15, fontWeight: '700' },
});

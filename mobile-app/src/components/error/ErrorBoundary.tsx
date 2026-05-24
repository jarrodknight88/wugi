// ─────────────────────────────────────────────────────────────────────
// Wugi — ErrorBoundary
// VENUE-DATA-07 Deliverable C + VENUE-DATA-08 Deliverable B
//
// Generic React error boundary so a render-time exception in one screen
// (typically a null deref against a Firestore doc with a missing field)
// degrades to a user-recoverable Retry / Back UI instead of force-closing
// the whole app.
//
// On render error, also writes a structured crash record to the Firestore
// `crashes` collection so post-mortem debugging has the actual stack +
// device context. Dedup window 1hr by (screen, eventId, errorMessage).
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { logCrash } from '../../lib/crashLogger';

type Props = {
  children: React.ReactNode;
  onBack?:  () => void;          // optional back handler (closes the broken screen)
  label?:   string;              // optional context label, e.g. 'event'
  // Crash-logger context — passed to Firestore `crashes` doc so post-mortem
  // can group by screen/event/venue without parsing the message.
  screen?:   string;             // canonical screen name (e.g. 'EventScreen')
  eventId?:  string | null;      // when wrapping an event-scoped render
  venueId?:  string | null;      // when wrapping a venue-scoped render
  showDetails?: boolean;         // dev-only: print the error message inline
};

type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Local console for dev; never re-thrown.
    console.log('ErrorBoundary caught:', this.props.label || this.props.screen || 'screen', error?.message);
    // Fire-and-forget crash log to Firestore. logCrash is wrapped in
    // its own try-catch and never throws — safe to await without guard.
    logCrash({
      screen:         this.props.screen || this.props.label || 'unknown',
      eventId:        this.props.eventId ?? null,
      venueId:        this.props.venueId ?? null,
      errorName:      error?.name,
      errorMessage:   error?.message || 'Unknown render error',
      errorStack:     error?.stack,
      componentStack: info?.componentStack || undefined,
    });
  }

  handleRetry = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    const { onBack, label = 'this screen', showDetails } = this.props;
    return (
      <View style={{ flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', paddingHorizontal: 28 }}>
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>
          Couldn't load {label}
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, textAlign: 'center', marginBottom: 24, lineHeight: 20 }}>
          Something went wrong rendering this content. Try again, or head back.
        </Text>
        <View style={{ flexDirection: 'row', gap: 12, justifyContent: 'center' }}>
          <TouchableOpacity
            onPress={this.handleRetry}
            style={{ paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, backgroundColor: '#2a7a5a' }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Retry</Text>
          </TouchableOpacity>
          {onBack && (
            <TouchableOpacity
              onPress={onBack}
              style={{ paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Back</Text>
            </TouchableOpacity>
          )}
        </View>
        {showDetails && (
          <ScrollView style={{ maxHeight: 200, marginTop: 24, padding: 12, backgroundColor: '#1a1a1a', borderRadius: 8 }}>
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontFamily: 'Courier' }}>
              {this.state.error.name}: {this.state.error.message}
            </Text>
          </ScrollView>
        )}
      </View>
    );
  }
}

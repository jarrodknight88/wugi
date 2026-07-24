// ─────────────────────────────────────────────────────────────────────
// Wugi — analyticsService
// Typed wrapper around @react-native-firebase/analytics. Mirrors the
// dynamic-import pattern already used for @react-native-firebase/firestore
// throughout the app (TicketSelectionScreen, GalleryScreen, PassScreens)
// so the analytics native module is only touched from screens that fire
// events, not pulled into the app's startup path.
//
// Logging never throws — a failed/queued analytics call must not break the
// screen it's attached to.
// ─────────────────────────────────────────────────────────────────────

async function logEvent(name: string, params: Record<string, string | number | null>): Promise<void> {
  try {
    const { getAnalytics, logEvent: firebaseLogEvent } = await import('@react-native-firebase/analytics');
    await firebaseLogEvent(getAnalytics(), name, params);
  } catch (e) {
    console.log(`analyticsService: ${name} failed`, e);
  }
}

export function logTicketViewed(params: {
  eventId: string;
  eventName: string;
  venueId: string;
  venueName: string;
}): void {
  logEvent('ticket_viewed', {
    event_id:   params.eventId,
    event_name: params.eventName,
    venue_id:   params.venueId,
    venue_name: params.venueName,
  });
}

export function logTicketAddedToCart(params: {
  eventId: string;
  ticketType: string;
  quantity: number;
  value: number; // decimal currency units (dollars), not cents
}): void {
  logEvent('ticket_added_to_cart', {
    event_id:    params.eventId,
    ticket_type: params.ticketType,
    quantity:    params.quantity,
    value:       params.value,
  });
}

export function logPassViewed(params: {
  eventId: string | null;
  passId: string;
}): void {
  logEvent('pass_viewed', {
    event_id: params.eventId,
    pass_id:  params.passId,
  });
}

export function logGalleryViewed(params: {
  eventId: string | null;
  venueId: string | null;
  photoCount: number;
}): void {
  logEvent('gallery_viewed', {
    event_id:    params.eventId,
    venue_id:    params.venueId,
    photo_count: params.photoCount,
  });
}

export function logVenueViewed(params: {
  venueId: string;
  venueName: string;
}): void {
  logEvent('venue_viewed', {
    venue_id:   params.venueId,
    venue_name: params.venueName,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Wugi — share
// Native share-sheet helpers for EventScreen / VenueScreen (UAT-W3-5).
//
// Link choice: wugi.us (not the `wugi://` deep-link scheme). Event/venue
// detail pages on wugi.us resolve by `slug` (events: /events/{slug}, venues:
// /{market}/{slug} — see web/app/events/[slug]/page.tsx and
// web/app/[market]/[slug]/page.tsx), but the mobile app's EventData/
// VenueData objects don't carry slug/market today — the toEventData/
// toVenueData mappers in HomeScreen/DiscoverScreen/DiscoverEditorialScreen/
// ItineraryDetailScreen/useVenueById/RootNavigator all build fresh object
// literals that strip any field they don't explicitly list. Threading
// slug/market through all of those is a real, separate change. The
// `wugi://` custom scheme (app.json `scheme: "wugi"`) also has no route
// handler for events/venues yet — deepLink.ts only parses ticket-claim
// links. Rather than ship a link that 404s or silently no-ops, share the
// wugi.us root; the message text carries the event/venue name (and, for
// events, the about copy) so the share still reads as meaningful. Fast-
// follow: plumb slug/market through the data layer and link straight to
// the detail page.
// ─────────────────────────────────────────────────────────────────────
import { Platform } from 'react-native';
// SDK 54 (expo-file-system v19) moved cacheDirectory/downloadAsync to the
// `/legacy` entry — see PhotoViewer.tsx for the same import and the fuller
// note on why (they're undefined on the new main entry).
import * as FileSystem from 'expo-file-system/legacy';

export const WUGI_SHARE_URL = 'https://wugi.us';

// Downloads a remote hero image to local cache so it can be attached to the
// native share sheet. RN's core Share API only attaches media when `url` is
// a LOCAL file URI — a remote https URL just shares as a web link, not an
// image (same lesson PhotoViewer.handleShare hit sharing full-res photos).
// Returns undefined on any failure so callers can fall back to a text-only
// share instead of blocking the action.
export async function downloadHeroForShare(remoteUri: string, idHint: string): Promise<string | undefined> {
  if (!remoteUri) return undefined;
  try {
    const baseDir = FileSystem.cacheDirectory;
    if (!baseDir) return undefined;
    const safeName = String(idHint || 'share').replace(/[^a-zA-Z0-9_-]/g, '_');
    const localUri = `${baseDir}wugi_share_${safeName}.jpg`;
    const { status } = await FileSystem.downloadAsync(remoteUri, localUri);
    return status === 200 ? localUri : undefined;
  } catch {
    return undefined;
  }
}

// RN's Share `url` field is iOS-only (Android has no first-party way to
// attach a local file without a content-provider package) — so only fetch
// the local file on iOS; Android can't use it and would just pay the
// download cost for nothing. Android shares text + link only.
export async function attachableImageUri(remoteUri: string, idHint: string): Promise<string | undefined> {
  if (Platform.OS !== 'ios') return undefined;
  return downloadHeroForShare(remoteUri, idHint);
}

export function buildEventShareMessage(event: { title: string; about?: string }): string {
  const blurb = `Check out ${event.title} on Wugi!`;
  const aboutBlock = event.about ? `${event.about}\n\npowered by @wugi` : 'powered by @wugi';
  return `${blurb}\n\n${aboutBlock}\n\n${WUGI_SHARE_URL}`;
}

export function buildVenueShareMessage(venue: { name: string }): string {
  return `Check out ${venue.name} on Wugi!\n\n${WUGI_SHARE_URL}`;
}

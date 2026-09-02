// ─────────────────────────────────────────────────────────────────────
// Wugi — apifyGalleryWebhook Cloud Function (photographer-site galleries →
// Firestore venueIntel ingest) — issue #267
//
// Sibling to apifyWebhook.ts, not a branch inside it: same run-verification
// + dataset-fetch + batched-write + media-persistence pipeline (all reused
// directly from that file), but for a *source*, not an *account* — one
// Apify actor task per photographer site (atlpics.net, nightlifelink.com),
// each crawling that site's gallery index into per-event items rather than
// scraping an Instagram profile's post feed.
//
// PERMISSIONS: Prince Williams (ATLpics) and Erin Kyle (NightLifeLink) have
// granted Wugi photo usage for their sites — see the issue. Every
// mediaAssets doc this function writes gets rightsStatus 'permission_granted'
// at ingest, never 'unverified': dashboard code already treats that value as
// publish-clear (see dashboard/lib/mediaSelection.ts, .../publishMedia.ts,
// draft-events/[id]/publish/route.ts — none of them needed to change).
//
// SOURCE DISCRIMINATOR: the Apify webhook payload carries no site info by
// default, so each site's Apify webhook must be configured with a custom
// payload template that merges a literal `"crawlSource"` field alongside
// the standard eventType/resource fields — see
// docs/GALLERY-CRAWLER-SETUP.md. That field, not the actor/task id, is what
// this function keys off of; it never needs to know either site's task id.
//
// EVERYTHING ELSE IS IDENTICAL TO apifyWebhook.ts: no shared webhook
// secret (the run is looked up via our own APIFY_TOKEN and rejected if it
// doesn't belong to us); never writes to production venues/ or events/;
// venueIntel is a staging-only review queue, and downstream classification
// (onVenueIntelApproved.ts) is untouched — a gallery item lands in the same
// pending_review queue as an Instagram post and is routed by the exact same
// classifier, keyed off accountType 'photographer' once a human approves
// 'atlpics.net' / 'nightlifelink.com' as a source in the dashboard's
// existing venue-intel-accounts "new account discovered" flow (same UI IG
// accounts go through — see dashboard/app/api/venue-intel-accounts/route.ts).
// Until that one-time approval, resolveVenue's undefined-accountType path
// still finds the venue via caption text (see resolveVenue in
// eventTransformRouting.ts), it just also attempts a harmless handle-match
// first.
//
// SECRETS REQUIRED (Firebase Secret Manager):
//   APIFY_TOKEN — same secret apifyWebhook/runTargetedScrape/
//                 syncApifySeedList already use.
// ─────────────────────────────────────────────────────────────────────

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import {
  fetchApifyRun,
  fetchDatasetItems,
  writeVenueIntelDocs,
  persistNewIntelMedia,
  MappedVenueIntelItem,
} from './apifyWebhook';

const apifyToken = defineSecret('APIFY_TOKEN');

export type GallerySource = 'atlpics' | 'nightlifelink';

// The pseudo "account" each source's docs are grouped under — deliberately
// NOT the bare 'atlpics' Instagram handle already present in
// SEED_ACCOUNTS (dashboard/app/api/venue-intel-accounts/route.ts): that's a
// different ingest path (@atlpics's own IG feed, scraped by apifyWebhook.ts)
// scraping a different thing (IG posts, not this site's gallery pages), and
// reusing the bare handle here would collide with that account's own
// venueIntelAccounts/{handle} doc and accountType decision.
const SOURCE_ACCOUNT: Record<GallerySource, string> = {
  atlpics: 'atlpics.net',
  nightlifelink: 'nightlifelink.com',
};

function isGallerySource(v: unknown): v is GallerySource {
  return v === 'atlpics' || v === 'nightlifelink';
}

// ── Normalization ────────────────────────────────────────────────────

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "Aug 15" from a Date's UTC month/day — guaranteed to round-trip through eventTransformCore's DATE_IN_TEXT_RE regex, unlike whatever raw date text the site itself uses. */
function formatMonD(date: Date): string {
  return `${MONTH_ABBR[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * Best-effort parse of whatever date text the gallery page renders — could
 * be "August 15, 2026", "8/15/2026", "2026-08-15", etc. depending on the
 * site (recon pending, see docs/GALLERY-CRAWLER-SETUP.md); JS's native Date
 * parser covers most of these without needing the actual site markup ahead
 * of time. Returns null (never throws) for anything it can't parse, same
 * as mapApifyItemToVenueIntelDoc's item.timestamp handling.
 */
export function parseFlexibleEventDate(text: string): Date | null {
  if (!text) return null;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return '';
}

/** Raw shape a gallery-crawl actor is expected to push per event/gallery — see docs/GALLERY-CRAWLER-SETUP.md for the actor-side contract. */
export interface GalleryCrawlItem {
  galleryUrl?: unknown;
  eventName?: unknown;
  eventDateText?: unknown;
  venueText?: unknown;
  photoUrls?: unknown;
}

/**
 * Pure item→doc mapper for one gallery-crawl dataset item, mirroring
 * mapApifyItemToVenueIntelDoc's contract (same MappedVenueIntelItem return
 * shape, same null-on-no-dedupe-key behavior) so it can feed the exact same
 * writeVenueIntelDocs/persistNewIntelMedia pipeline. childVideoUrls is
 * always [] — a photo gallery has no carousel-video concept, so
 * persistNewIntelMedia's non-carousel branch runs, downloading every
 * photoUrl (up to MAX_MEDIA_PER_POST) as its own image asset.
 *
 * caption is synthesized (eventName / venueText / a date fragment) purely
 * so the existing venueIntel routing classifier (matchVenueInCaption +
 * extractDateFromText in eventTransformRouting.ts / eventTransformCore.ts)
 * can run completely unmodified — it has no idea this doc didn't come from
 * an Instagram caption.
 */
export function mapGalleryItemToVenueIntelDoc(
  item: GalleryCrawlItem,
  runId: string,
  source: GallerySource
): MappedVenueIntelItem | null {
  const galleryUrl = firstNonEmptyString(item?.galleryUrl);
  if (!galleryUrl) return null;

  const docId = crypto.createHash('sha256').update(galleryUrl).digest('hex').slice(0, 32);

  const eventName = firstNonEmptyString(item?.eventName);
  const venueText = firstNonEmptyString(item?.venueText);
  const rawDateText = firstNonEmptyString(item?.eventDateText);

  const parsedDate = parseFlexibleEventDate(rawDateText);
  const dateFragment = parsedDate ? formatMonD(parsedDate) : rawDateText;

  const caption = [eventName, venueText && `@ ${venueText}`, dateFragment].filter(Boolean).join(' — ');

  const photoUrls = Array.isArray(item?.photoUrls)
    ? item.photoUrls.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    : [];

  const sourceAccount = SOURCE_ACCOUNT[source];

  return {
    docId,
    doc: {
      sourceAccount,
      seedAccount: sourceAccount,
      postUrl: galleryUrl,
      caption,
      postedAt: parsedDate ? admin.firestore.Timestamp.fromDate(parsedDate) : null,
      likesCount: 0,
      commentsCount: 0,
      mediaUrls: photoUrls,
      videoUrl: null,
      runId,
      mentionedHandles: [],
      source,
    },
    childVideoUrls: [],
  };
}

// ── Main Cloud Function ──────────────────────────────────────────────

export const apifyGalleryWebhook = onRequest(
  {
    secrets: [apifyToken],
    region: 'us-central1',
    // Same rationale as apifyWebhook.ts: dataset pagination, batched
    // Firestore writes, and downloading up to MAX_MEDIA_PER_POST photos per
    // new gallery can take a while for a large crawl run.
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (req, res) => {
    const payload = req.body ?? {};
    const eventType = payload.eventType;
    const resource = payload.resource ?? {};
    const runId = resource.id;
    const defaultDatasetId = resource.defaultDatasetId;
    const crawlSource = payload.crawlSource;

    if (eventType !== 'ACTOR.RUN.SUCCEEDED' || !runId || !defaultDatasetId || !isGallerySource(crawlSource)) {
      logger.warn('apifyGalleryWebhook: malformed payload', { eventType, runId, defaultDatasetId, crawlSource });
      res.status(400).send('Bad Request');
      return;
    }

    const token = apifyToken.value();

    let run: { id: string } | null;
    try {
      run = await fetchApifyRun(runId, token);
    } catch (err) {
      logger.warn('apifyGalleryWebhook: run verification failed', { runId, err: String(err) });
      res.status(401).send('Unauthorized');
      return;
    }
    if (!run || run.id !== runId) {
      logger.warn('apifyGalleryWebhook: run not found under our account', { runId });
      res.status(401).send('Unauthorized');
      return;
    }

    try {
      const items = await fetchDatasetItems(defaultDatasetId, token);

      const mapped: MappedVenueIntelItem[] = [];
      let unmappable = 0;
      for (const item of items) {
        const m = mapGalleryItemToVenueIntelDoc(item, runId, crawlSource);
        if (m) mapped.push(m);
        else unmappable++;
      }

      const { ingested, errors, newItems } = await writeVenueIntelDocs(mapped);
      const skipped = unmappable + errors;

      logger.info('apifyGalleryWebhook: run summary', {
        runId,
        crawlSource,
        itemCount: items.length,
        ingested,
        errors,
        newItems: newItems.length,
      });

      await persistNewIntelMedia(newItems, 'permission_granted').catch((err) =>
        logger.error('apifyGalleryWebhook: media persistence pass failed', { runId, crawlSource, err: String(err) })
      );

      res.status(200).json({ ingested, skipped });
    } catch (err) {
      logger.error('apifyGalleryWebhook: handler failed', { runId, crawlSource, err: String(err) });
      res.status(500).send('Internal Server Error');
    }
  }
);

// ─────────────────────────────────────────────────────────────────────
// Wugi — onVenueIntelApproved (venueIntel approval -> draft events / intel)
//
// Fires on the transition into venueIntel/{id}.status == 'approved'
// (dashboard "Approve" / "Approve all" actions — see
// dashboard/app/api/venue-intel/route.ts and .../bulk/route.ts). Routes
// the post via the pure classifier in eventTransformRouting.ts:
//
//   draft_event         -> upsert draftEvents/{docId}. NEVER production
//                          events/ — draftEvents is a staging collection;
//                          promotion is a later, ladder-gated step.
//   night_observation    -> nightObservations/{autoId} + append a 'recap'
//                          entry to venues/{venueId}/intel (append-only;
//                          never writes venue listing fields).
//   needs_classification -> venueIntel doc gets status
//                          'needs_classification' + classificationReason.
//
// Idempotent: transform.processedAt is checked before any write and set
// as part of every outcome, so re-fires (Firestore triggers are
// at-least-once) are safe no-ops. draftEvents additionally dedupes via a
// deterministic docId (hash of venueId + date + normalized title), so
// even a concurrent double-fire can't create two drafts for the same
// event.
//
// scripts/backfill-approved-intel.js runs this exact routing (via the
// compiled lib/ output) over the venueIntel backlog post-deploy — see
// that script for the batch/dry-run version of this same logic.
//
// Scraped IG media is INTEL ONLY: nothing here writes a mediaUrl into any
// consumer-facing photo surface.
// ─────────────────────────────────────────────────────────────────────
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { buildVenueIndex, normalizeText, Venue, TIMEZONE } from './eventTransformCore';
import { classifyIntelPost, AccountType, IntelRoutingInput } from './eventTransformRouting';

function todayISOInTimeZone(tz: string): string {
  // en-CA formats as YYYY-MM-DD, which sorts/compares the same as the
  // dateISO strings the classifier produces.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date()
  );
}

function draftEventDocId(venueId: string, dateISO: string, normalizedTitle: string): string {
  return crypto.createHash('sha256').update(`${venueId}|${dateISO}|${normalizedTitle}`).digest('hex').slice(0, 32);
}

async function fetchAllVenues(db: admin.firestore.Firestore): Promise<Venue[]> {
  const snap = await db.collection('venues').select('name', 'aliases', 'instagram').get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Venue, 'id'>) }));
}

async function resolveAccountType(
  db: admin.firestore.Firestore,
  sourceAccount: string
): Promise<AccountType | undefined> {
  if (!sourceAccount) return undefined;
  const snap = await db.collection('venueIntelAccounts').doc(sourceAccount).get();
  if (!snap.exists) return undefined;
  const accountType = snap.data()?.accountType;
  return typeof accountType === 'string' ? (accountType as AccountType) : undefined;
}

/**
 * Media persistence (issue #141) stages a mediaAssets/{intelId} doc for
 * posts whose media was downloaded at scrape time — but back then no venue
 * was known yet. Once routing resolves a venue (draft_event or
 * night_observation, never needs_classification), backfill it onto the
 * asset doc if one exists. Best-effort: a missing/pre-existing asset doc
 * is a normal no-op, never worth failing the approval transition over.
 */
async function linkMediaAssetVenue(db: admin.firestore.Firestore, intelId: string, venueId: string): Promise<void> {
  try {
    const ref = db.collection('mediaAssets').doc(intelId);
    const snap = await ref.get();
    if (snap.exists) await ref.set({ venueId }, { merge: true });
  } catch (err) {
    logger.warn('onVenueIntelApproved: mediaAssets venue link failed', { intelId, venueId, err: String(err) });
  }
}

export const onVenueIntelApproved = onDocumentUpdated('venueIntel/{id}', async (event) => {
  const change = event.data;
  if (!change) return;

  const before = change.before.data();
  const after = change.after.data();
  if (!before || !after) return;

  // Only the transition INTO approved — never re-trigger on other edits.
  if (before.status === 'approved' || after.status !== 'approved') return;
  // Idempotency guard: this same transition may be redelivered.
  if (after.transform?.processedAt) return;

  const db = admin.firestore();
  const intelRef = change.after.ref;
  const intelId = event.params.id;

  const sourceAccount: string = after.sourceAccount || '';
  const caption: string = after.caption || '';
  const postedAt: Date | null = after.postedAt?.toDate?.() ?? null;
  // Structured taggedUsers/mentions from the Apify item (issue #236) —
  // see apifyWebhook.ts mapApifyItemToVenueIntelDoc's mentionedHandles.
  const structuredMentions: string[] = Array.isArray(after.mentionedHandles) ? after.mentionedHandles : [];

  const [accountType, venues] = await Promise.all([resolveAccountType(db, sourceAccount), fetchAllVenues(db)]);
  const venueIndex = buildVenueIndex(venues);

  // A human-assigned venue (dashboard Needs Attention picker, PATCH
  // /api/venue-intel/[id]) takes priority over the heuristic matcher — see
  // resolveVenue in eventTransformRouting.ts.
  const manualVenueId: string | null = typeof after.venueId === 'string' && after.venueId ? after.venueId : null;

  const input: IntelRoutingInput = {
    sourceAccount,
    caption,
    postedAt,
    accountType,
    manualVenueId,
    structuredMentions,
  };
  const result = classifyIntelPost(input, venueIndex, todayISOInTimeZone(TIMEZONE));

  const now = admin.firestore.FieldValue.serverTimestamp();

  if (result.outcome === 'draft_event') {
    const docId = draftEventDocId(result.venue.id, result.dateISO, normalizeText(result.title));
    const draftRef = db.collection('draftEvents').doc(docId);
    const existing = await draftRef.get();

    await draftRef.set(
      {
        venueId: result.venue.id,
        venueName: result.venue.name,
        date: admin.firestore.Timestamp.fromDate(new Date(`${result.dateISO}T00:00:00Z`)),
        title: result.title,
        caption,
        likesCount: after.likesCount ?? 0,
        commentsCount: after.commentsCount ?? 0,
        sourceAttribution: {
          account: sourceAccount,
          postUrl: after.postUrl || '',
          seedAccount: after.seedAccount || '',
        },
        sourceIntelId: intelId,
        status: 'draft',
        updatedAt: now,
        ...(existing.exists ? {} : { createdAt: now }),
      },
      { merge: true }
    );

    await intelRef.set({ transform: { processedAt: now, outcome: 'draft_event', refId: docId } }, { merge: true });
    await linkMediaAssetVenue(db, intelId, result.venue.id);
    logger.info('onVenueIntelApproved: draft_event', { intelId, refId: docId, venueId: result.venue.id });
    return;
  }

  if (result.outcome === 'night_observation') {
    const obsRef = db.collection('nightObservations').doc();

    await obsRef.set({
      venueId: result.venue.id,
      dayOfWeek: result.dayOfWeek,
      date: admin.firestore.Timestamp.fromDate(new Date(`${result.dateISO}T00:00:00Z`)),
      sourceIntelId: intelId,
      likesCount: after.likesCount ?? 0,
      commentsCount: after.commentsCount ?? 0,
      sourceAccount,
      createdAt: now,
    });

    await db
      .collection('venues')
      .doc(result.venue.id)
      .collection('intel')
      .add({
        type: 'recap',
        postUrl: after.postUrl || '',
        caption: caption.slice(0, 300),
        engagement: { likesCount: after.likesCount ?? 0, commentsCount: after.commentsCount ?? 0 },
        at: now,
      });

    await intelRef.set(
      { transform: { processedAt: now, outcome: 'night_observation', refId: obsRef.id } },
      { merge: true }
    );
    await linkMediaAssetVenue(db, intelId, result.venue.id);
    logger.info('onVenueIntelApproved: night_observation', { intelId, refId: obsRef.id, venueId: result.venue.id });
    return;
  }

  await intelRef.set(
    {
      status: 'needs_classification',
      classificationReason: result.reason,
      transform: { processedAt: now, outcome: 'needs_classification' },
    },
    { merge: true }
  );
  logger.info('onVenueIntelApproved: needs_classification', { intelId, reason: result.reason });
});

// ─────────────────────────────────────────────────────────────────────
// Wugi — Venue Asset Pool: coverage counter (issue #269)
//
// Maintains venues/{venueId}.approvedAssetCount as venueAssets docs are
// created/updated/deleted, so the dashboard's venue list and coverage report
// can read the count directly off the venues collection it already fetches
// instead of running a count() aggregation query per venue on every page
// load (497 venues as of 2026-08 — see AGENTS.md). FieldValue.increment
// keeps this a single cheap write per transition, matching the existing
// counter pattern (chargebackSuspension.ts, ingestLensUpload.ts pendingCount/
// publishedCount).
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

const db = admin.firestore();

function delta(before: FirebaseFirestore.DocumentData | undefined, after: FirebaseFirestore.DocumentData | undefined): number {
  const wasApproved = before?.approved === true;
  const isApproved = after?.approved === true;
  if (wasApproved === isApproved) return 0;
  return isApproved ? 1 : -1;
}

export const onVenueAssetCoverageChange = functions.firestore
  .document('venueAssets/{assetId}')
  .onWrite(async (change) => {
    const before = change.before.exists ? change.before.data() : undefined;
    const after = change.after.exists ? change.after.data() : undefined;

    const d = delta(before, after);
    if (d === 0) return;

    const venueId = (after?.venueId || before?.venueId) as string | undefined;
    if (!venueId) return;

    try {
      await db.collection('venues').doc(venueId).update({
        approvedAssetCount: admin.firestore.FieldValue.increment(d),
      });
    } catch (err) {
      logger.error('onVenueAssetCoverageChange failed', { venueId, err });
    }
  });

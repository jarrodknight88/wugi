// ─────────────────────────────────────────────────────────────────────
// rollForwardSeriesAnchors — VENUE-DATA-08 Deliverable C
//
// Daily job: scan event series with isSeriesAnchor=true. If the anchor's
// dateISO has passed, demote it (isSeriesAnchor=false, drop seriesOccurrences)
// and promote the next-future sibling (isSeriesAnchor=true, set
// seriesOccurrences to the full sibling list).
//
// If no future sibling exists, the series goes dormant: no anchor at all,
// stays out of consumer feeds. The next scrape (or backfill re-run) will
// pick a new anchor when fresh occurrences land.
//
// Cron: 04:00 America/New_York daily.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();
const FV = admin.firestore.FieldValue;

function todayISO(): string {
  // Use America/New_York to match the cron timezone — anchor "passed" means
  // the date is strictly before today in the venue's market timezone.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date()); // 'YYYY-MM-DD'
}

async function rollForwardOnce(): Promise<{
  scanned: number;
  demoted: number;
  promoted: number;
  dormantSeries: number;
}> {
  const today = todayISO();

  // All current anchors with a past dateISO.
  // (We can't where('dateISO', '<', today) AND where('isSeriesAnchor', '==', true)
  //  without a composite index — so do a single isSeriesAnchor query and filter
  //  client-side. Anchor count is bounded by series count, ~500-1000 max.)
  const anchorSnap = await db.collection('events')
    .where('isSeriesAnchor', '==', true)
    .get();

  const stale = anchorSnap.docs.filter((d) => {
    const iso = (d.data().dateISO || '');
    return iso && iso < today;
  });

  let demoted = 0;
  let promoted = 0;
  let dormantSeries = 0;

  for (const doc of stale) {
    const seriesId = doc.data().seriesId;
    if (!seriesId) {
      // No seriesId on a flagged anchor — likely a backfill miss. Just demote.
      await doc.ref.update({
        isSeriesAnchor: false,
        seriesOccurrences: FV.delete(),
        updatedAt: FV.serverTimestamp(),
      });
      demoted += 1;
      continue;
    }

    // Find sibling occurrences for this seriesId
    const siblingSnap = await db.collection('events')
      .where('seriesId', '==', seriesId)
      .get();
    const siblings = siblingSnap.docs.map((s) => ({ id: s.id, ref: s.ref, dateISO: s.data().dateISO || '' }));

    // Pick the next future sibling (lowest dateISO that's today or later)
    const future = siblings.filter((s) => s.dateISO >= today);
    future.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    const nextAnchor = future[0] || null;

    const allIds = siblings.map((s) => s.id);

    // Demote the stale anchor
    await doc.ref.update({
      isSeriesAnchor: false,
      seriesOccurrences: FV.delete(),
      updatedAt: FV.serverTimestamp(),
    });
    demoted += 1;

    // Promote the new anchor (if any)
    if (nextAnchor) {
      await nextAnchor.ref.update({
        isSeriesAnchor: true,
        seriesOccurrences: allIds,
        updatedAt: FV.serverTimestamp(),
      });
      promoted += 1;
    } else {
      dormantSeries += 1;
    }
  }

  return { scanned: anchorSnap.size, demoted, promoted, dormantSeries };
}

// Scheduled — daily 4am America/New_York.
export const rollForwardSeriesAnchors = functions.pubsub
  .schedule('0 4 * * *')
  .timeZone('America/New_York')
  .onRun(async () => {
    const result = await rollForwardOnce();
    console.log(`rollForwardSeriesAnchors:`, result);
    // Audit entry on the meta collection
    await db.collection('meta').doc('series-rollforward-runs').collection('runs').add({
      ranAt: FV.serverTimestamp(),
      todayISO: todayISO(),
      ...result,
    });
  });


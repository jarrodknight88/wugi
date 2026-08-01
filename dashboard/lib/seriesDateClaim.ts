import type { Firestore } from "firebase-admin/firestore"

// One occurrence per series per date — an edition claims its date. Mirrors
// the in-memory dedupe functions/src/series/generateSeriesEvents.ts's
// planSeries already does against `events.where('seriesId','==',seriesId)`
// (single-field query + in-memory dateISO compare, no composite index
// needed) — reused here so write paths that attach an existing/live event
// to a series enforce the same rule at write time, not just at generation
// time.
export async function findDateClaimConflict(
  db: Firestore,
  seriesId: string,
  dateISO: string,
  excludeEventId?: string
): Promise<string | null> {
  const snap = await db.collection("events").where("seriesId", "==", seriesId).get()
  const conflict = snap.docs.find((d) => d.id !== excludeEventId && d.data().dateISO === dateISO)
  return conflict ? conflict.id : null
}

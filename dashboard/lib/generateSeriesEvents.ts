// Best-effort forwarder for the existing generateSeriesEvents Cloud Function
// (functions/src/series/generateSeriesEvents.ts — a v1 https.onCall, not
// modified by this change). series/page.tsx's browser client calls it via
// httpsCallable(); a Next.js API route has no Firebase client SDK context,
// so this hits the callable's plain HTTPS endpoint directly, forwarding the
// same admin's ID token that already passed requireVenueIntelStaff (whose
// role is always in the function's own SERIES_WRITE_ROLES allow-list).
//
// Deliberately non-fatal: if this fails (cold start, network, wrong region),
// the newly-created series still gets its anchor occurrence (written
// directly by the publish route) and the rest of the rolling window fills
// in via generateSeriesEventsScheduled (nightly, 05:00 ET) or the Series
// page's manual "+ Generate" button. Never let this block a publish.
export async function tryGenerateSeriesEvents(seriesId: string, bearerToken: string): Promise<"ok" | "failed" | "skipped"> {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  if (!projectId) return "skipped"
  try {
    const res = await fetch(`https://us-central1-${projectId}.cloudfunctions.net/generateSeriesEvents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearerToken}` },
      body: JSON.stringify({ data: { seriesId, weeksAhead: 8 } }),
      signal: AbortSignal.timeout(8000),
    })
    return res.ok ? "ok" : "failed"
  } catch {
    return "failed"
  }
}

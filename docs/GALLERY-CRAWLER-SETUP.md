# Photographer-site gallery crawler — setup (issue #267)

*Companion to [`VENUE-INTEL-SOP.md`](./VENUE-INTEL-SOP.md). Read that first —
everything below plugs into the exact same review/classify/publish pipeline,
just with a second kind of scrape feeding it.*

## What this is

A second ingest path into the same `venueIntel` staging collection the
Instagram scrape already fills, sourced from two photographer sites instead
of Instagram profiles:

- **atlpics.net** (Prince Williams)
- **nightlifelink.com** (Erin Kyle)

Both photographers have granted Wugi photo usage — see the Asana task linked
from issue #267. Every asset ingested from these two sources gets
`rightsStatus: 'permission_granted'` at write time (never `'unverified'`),
so it never hits the publish-blocking rights gate described in
`VENUE-INTEL-SOP.md` §6.

## What's implemented (this PR)

- `functions/src/bridge/apifyGalleryWebhook.ts` — a new Cloud Function,
  sibling to `apifyWebhook.ts` (not a branch inside it). Reuses that file's
  run-verification, dataset-fetch, batched-write, and media-persistence
  logic directly (exported for this purpose) rather than duplicating it.
  Takes a **source discriminator** (`crawlSource: 'atlpics' | 'nightlifelink'`)
  from a custom field on the Apify webhook payload — see "Apify-side setup"
  below — so one function serves both sites; no per-site code.
- `mapGalleryItemToVenueIntelDoc` — pure item→doc mapper, expects each Apify
  dataset item shaped as:
  ```ts
  {
    galleryUrl: string;      // per-gallery page URL — the dedupe key
    eventName?: string;
    eventDateText?: string;  // any human-readable date text; best-effort parsed
    venueText?: string;      // venue name as written on the page
    photoUrls?: string[];
  }
  ```
  This is the **contract the actor's page function must produce** — see
  below. It synthesizes a caption (`eventName — @ venueText — Aug 15`) from
  those fields purely so the *existing, unmodified* venueIntel routing
  classifier (`eventTransformRouting.ts` — date extraction + venue-name
  matching) can classify a gallery recap exactly like it classifies an
  Instagram caption. Zero changes to `onVenueIntelApproved.ts`.
- `venueIntel` docs gain an optional `source: 'atlpics' | 'nightlifelink'`
  field (unset for Instagram docs — fully backward compatible).
- `mediaAssets` docs gain a `rightsStatus` input to `buildMediaAssetDoc`
  (defaults to `'unverified'`, unchanged for the Instagram path); the
  gallery path passes `'permission_granted'`.
- Unit tests: `npm run test:apify-gallery-normalize` (also runs as part of
  `npm test`).

## What's NOT implemented — and why

**The actual Apify actor page-function (the CSS selectors / gallery-index
URL pattern for each site) is not written.** The issue's own design sketch
flags this explicitly: *"Site structure recon required first (PM: fetch
both sites, map gallery URL patterns + selectors into the actor config)."*

That recon requires live network access to atlpics.net and
nightlifelink.com (fetching pages, inspecting real DOM structure). **The
sandbox this PR was written in has no outbound network access** (`WebFetch`,
`WebSearch`, and even `curl` all required interactive approval that wasn't
available) — so guessing at selectors for two real production sites and
shipping them un-verified would risk silently scraping garbage (or
nothing). That part is left to whoever picks this up next, with a template
below to make it fast.

## Apify-side setup (PM / next session with browser access)

For **each site** (atlpics.net, nightlifelink.com):

1. **Recon**: open the site, find the gallery index page(s) (pagination
   pattern?) and one representative gallery page. Note:
   - The gallery-index → per-gallery URL pattern (for `startUrls`).
   - The selector for each gallery's link on the index page.
   - On a gallery page: selectors for the event name, date text, venue
     name/text, and the photo `<img>` elements (prefer full-res `src`/
     `data-src` over thumbnails if the markup distinguishes them).
2. **Create an Apify actor task** — Cheerio Crawler (fast, no JS rendering)
   if the galleries are server-rendered; fall back to Website Content
   Crawler / Puppeteer Crawler only if the site needs JS execution to
   render photos.
3. **Page function** — must call `Actor.pushData(...)` with exactly the
   `GalleryCrawlItem` shape above, one item per gallery page. Skeleton:
   ```js
   // Cheerio Crawler pageFunction — fill in the selectors marked TODO
   async function pageFunction({ $, request }) {
     const galleryUrl = request.url;
     const eventName = $('TODO-event-name-selector').text().trim();
     const eventDateText = $('TODO-date-selector').text().trim();
     const venueText = $('TODO-venue-selector').text().trim();
     const photoUrls = $('TODO-photo-img-selector')
       .map((_, el) => $(el).attr('src') || $(el).attr('data-src'))
       .get()
       .filter(Boolean);

     await Actor.pushData({ galleryUrl, eventName, eventDateText, venueText, photoUrls });
   }
   ```
4. **Webhook** — Apify task → Integrations → Webhooks → add one for
   `ACTOR.RUN.SUCCEEDED`, pointed at the deployed `apifyGalleryWebhook`
   function URL (`firebase functions:list` or the Firebase console after
   deploy). **Customize the payload template** to merge in the source
   discriminator — this is the one Apify-side step the function's auth
   depends on:
   ```json
   {
     "eventType": "{{eventData.eventType}}",
     "resource": {{resource}},
     "crawlSource": "atlpics"
   }
   ```
   (`"nightlifelink"` for the other site's webhook.) Without this field the
   function rejects the payload with 400.
5. **Schedule** — add a weekly Apify Schedule for the task, same pattern as
   the existing Monday 6am ET Instagram scrape (`wugi-monday-6am-et` — see
   `VENUE-INTEL-SOP.md` §1). A different day/time than the IG scrape avoids
   both webhooks landing on the Cloud Function at once.

## Deploy

```bash
cd functions
npm run build                 # tsc --noEmit already verified 0 new errors vs. baseline
npm test                      # full suite, includes the new gallery-normalize tests
firebase deploy --only functions:apifyGalleryWebhook
```

`APIFY_TOKEN` is already provisioned in Firebase Secret Manager (shared
with `apifyWebhook`/`runTargetedScrape`/`syncApifySeedList`) — no new secret
needed.

## After the first real crawl run

1. Watch **Venue Intel → review queue** in the dashboard — gallery items
   should appear as pending-review posts, `postUrl` linking to the gallery
   page.
2. Approve a couple. They'll route through the same classifier as IG posts
   (draft event / night observation / needs attention).
3. `atlpics.net` and `nightlifelink.com` will show up as new candidate
   accounts in **venue-intel-accounts** (same "new account discovered" flow
   IG accounts go through). Approve both with `accountType: 'photographer'`
   — this lets the classifier skip the (irrelevant) handle-match step and
   go straight to venue-name text matching, same as any promoter/photographer
   IG account.
4. Spot-check a published draft's media rights badge — should read
   `permission_granted`, never `unverified`.

## Reviewer checklist

- [ ] `npm run build` (tsc) in `functions/` shows 0 errors — matches the
      documented `functions/` baseline in the root `CLAUDE.md` (0 errors).
- [ ] `npm test` in `functions/` passes, including
      `test:apify-gallery-normalize`.
- [ ] Confirm `persistNewIntelMedia`'s IG call site
      (`apifyWebhook.ts`) still omits the `rightsStatus` arg — it must keep
      defaulting to `'unverified'` for Instagram-sourced media.
- [ ] Confirm no existing `venueIntel` or `mediaAssets` doc shape assumption
      breaks on the new optional `source` / `rightsStatus` fields (both
      additive, both absent unless explicitly set).
- [ ] Before merging further Apify-side config: do the site recon (§
      "Apify-side setup" above) and fill in real selectors — this PR does
      not and cannot include them (no network access in the authoring
      sandbox).
- [ ] After deploy + first live run: approve `atlpics.net` /
      `nightlifelink.com` as `accountType: 'photographer'` in
      venue-intel-accounts (see "After the first real crawl run" above).

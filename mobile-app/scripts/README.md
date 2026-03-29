# Wugi Scripts

Production scripts for managing venue data, Instagram handles, and logos.

## Active Scripts

### `importPlaces.js` — Venue import and refresh
The core data pipeline. Imports venues from Google Places, looks up Instagram handles via SerpAPI, and refreshes existing venue data.

```bash
# Import new venues by neighborhood
node importPlaces.js --neighborhood="Midtown"
node importPlaces.js --all

# Refresh existing venue data (preserves owner-set fields)
node importPlaces.js --refresh
node importPlaces.js --refresh --neighborhood="Buckhead"

# Instagram lookup only (always --test first to check SerpAPI quota)
node importPlaces.js --instagram-only --test
node importPlaces.js --instagram-only

# Close a venue (add replacedBy if there's a successor)
node importPlaces.js --close --docId="opera-atlanta"
node importPlaces.js --close --docId="opera-atlanta" --replacedBy="gp_xxx"
```

**Requires:** `scripts/.env` with `GOOGLE_PLACES_API_KEY` and `SERP_API_KEY`

---

### `fetchInstagramLogos.js` — Fetch Instagram profile pics
Scrapes Instagram profile pic URLs from public Instagram pages for venues that have handles. Run after importing new venues.

```bash
node fetchInstagramLogos.js --test    # test 5 venues first
node fetchInstagramLogos.js           # run all venues missing logoUrl
node fetchInstagramLogos.js --force   # re-fetch even if logoUrl exists
```

**Cost:** Free — no SerpAPI calls. Scrapes public og:image meta tags.

---

### `cacheLogoImages.js` — Upload logos to Firebase Storage
Downloads Instagram CDN images (which expire) and uploads them to Firebase Storage for permanent URLs. Always run after `fetchInstagramLogos.js`.

```bash
node cacheLogoImages.js --test    # test 5 venues
node cacheLogoImages.js           # upload all Instagram CDN logos
```

**Output:** `storage.googleapis.com/wugi-prod.firebasestorage.app/venue-logos/{venueId}.jpg`

---

## Environment

All scripts require `scripts/.env`:
```
GOOGLE_PLACES_API_KEY=your_key
SERP_API_KEY=your_key
```

And `scripts/serviceAccount.json` (Firebase Admin SDK key — never commit).

Both files are gitignored.

---

## archive/

One-time scripts that have already been run. Do not run again.
- `seedAtlanta.js` — Initial venue seed (208 venues)
- `patchSeededVenues.js` — One-time patch for manually seeded venues
- `seedTicketingTest.js` — Test event data for ticketing development
- `fixLogoUrls.js` — One-time fix for HTML-encoded logoUrls

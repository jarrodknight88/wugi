# Wugi Venue Data Model

## Overview

Venues are the core data entity in Wugi. They are seeded automatically via the
Google Places import script and can be claimed by venue owners. The data model
is designed around the "chicken and egg" problem — venues are visible in the app
as `unclaimed` before any venue owner has signed up, providing immediate consumer
value.

---

## Status Model

Five statuses control venue visibility and behavior across the platform:

```
pending_review → unclaimed → approved
                           → closed
                           → disabled
```

| Status | Visible in app | Claim CTA | Discovery | Notes |
|--------|---------------|-----------|-----------|-------|
| `pending_review` | ✅ Yes | ✅ Yes | ✅ Yes | Confidence < 80. Needs admin approval before going fully live |
| `unclaimed` | ✅ Yes | ✅ Yes | ✅ Yes | Confidence ≥ 80. Auto-live. Shows "Claim this venue" CTA |
| `approved` | ✅ Yes | ❌ No | ✅ Yes | Venue has claimed and verified their profile |
| `closed` | ✅ Yes | ❌ No | ❌ No | Permanently closed. Shows closure banner. Not in discovery |
| `disabled` | ❌ No | ❌ No | ❌ No | Hidden completely. Used for duplicates and bad data |

### Key decisions:
- `unclaimed` venues are visible — solves the chicken and egg problem
- `closed` is distinct from `disabled` — closed venues have history and user
  favorites. We acknowledge closure gracefully rather than hiding it.
- `pending_review` venues are visible but flagged in the admin dashboard

---

## Confidence Scoring

Every venue has a confidence score (0–100) calculated from field-level scores.
This determines whether the venue auto-goes-live or needs manual review.

### Field weights (must sum to 100):

| Field | Weight | Score logic |
|-------|--------|-------------|
| name | 20 | 95 if present, 0 if missing |
| address | 20 | 95 if Atlanta/GA address, 70 if other, 0 if missing |
| phone | 15 | 90 if present, 0 if missing |
| website | 15 | 85 if https://, 70 if http://, 0 if missing |
| hours | 10 | 80 if full week (7 days), 50 if partial, 0 if missing |
| photos | 10 | 75 if 3+ photos, 40 if 1–2, 0 if none |
| instagram | 5 | 85 SerpAPI confirmed, 65 SerpAPI probable, 45 inferred-high, 30 inferred-medium |
| parking | 5 | 60 if any parking option true, 30 if data present but all false, 0 if missing |

### Thresholds:
- Field score < 60 → field hidden in app (shows CTA instead)
- Overall score < 80 → `status: 'pending_review'` (admin must approve)
- Overall score ≥ 80 → `status: 'unclaimed'` (auto-live)

### Per-field visibility:
When a field's confidence score is below 60, the app shows a CTA instead of
the field value:
- `instagram` → "Add your Instagram →" (links to claim flow)
- Other fields → field simply not shown

---

## Instagram Strategy

Instagram handles are looked up via SerpAPI (`site:instagram.com` search).
Fallback is name inference if SerpAPI fails or quota is exhausted.

### Confidence levels:
- `high` (score 85) — SerpAPI found an exact or strong name match
- `medium` (score 65) — SerpAPI found a probable match
- `inferred-high` (score 45) — Generated from venue name, strong match
- `inferred-medium` (score 30) — Generated from venue name, weak match

### Key fields:
```
instagram:         "@handle"
instagramSource:   "serpapi" | "inferred"
instagramInferred: true | false
```

When `instagramInferred: true`, the app shows "Add your Instagram →" CTA
even if a handle exists, because it's unverified.

### Script commands:
```bash
node importPlaces.js --instagram-only --test   # Test 5 venues first (always start here)
node importPlaces.js --instagram-only          # Run all venues missing confirmed handle
```

---

## Neighborhood Data Model

Every imported venue has neighborhood data attached for the Discover
neighborhood filter feature.

```typescript
{
  neighborhood: "Midtown",
  neighborhoodSlug: "midtown",
  neighborhoodBounds: {
    north: 33.8050,
    south: 33.7850,
    east: -84.3650,
    west: -84.4050
  }
}
```

### Atlanta neighborhoods (Tier 1 → Tier 3):

**Tier 1 — Core nightlife:**
Midtown, Buckhead, Old Fourth Ward, East Atlanta Village

**Tier 2 — Growing:**
Westside, Downtown, Inman Park, Virginia Highland, Little Five Points

**Tier 3 — Expanding:**
Summerhill, Decatur, Sandy Springs, Castleberry Hill

---

## Hours Model

```typescript
{
  hours: [
    "Monday: 5:00 PM – 2:00 AM",
    "Tuesday: 5:00 PM – 2:00 AM",
    // ... one string per day
  ],
  hoursVisible: true,           // toggle from admin dashboard or on claim
  specialHours: [
    {
      date: "2026-07-04",
      label: "July 4th",
      hours: "6:00 PM – 4:00 AM",
      isClosed: false
    },
    {
      date: "2026-12-25",
      label: "Christmas",
      hours: null,
      isClosed: true
    }
  ]
}
```

Hours are pulled directly from Google Places as weekday description strings.
Special hours are added manually by the venue owner or admin.

---

## Parking Model

Pulled from Google Places `parkingOptions` field:

```typescript
{
  parking: {
    freeParking:   boolean,
    paidParking:   boolean,
    valetParking:  boolean,
    streetParking: boolean,
    garageParking: boolean
  }
}
```

Parking confidence score < 60 → field hidden in app.

---

## Closure Model

When a venue closes, it is NOT deleted or disabled. It is marked `closed` and
linked to its replacement venue if one exists.

### Closure ≠ Transfer
Venue changes (e.g. Opera Atlanta → Domaine ATL) are modeled as:
1. Close the old venue (`status: 'closed'`, add `replacedBy` link)
2. Create/identify the new venue
3. Add `previousVenue` backlink on the new venue

This preserves data integrity. User favorites and history stay attached to the
closed venue record.

```typescript
// Closed venue (opera-atlanta)
{
  status: 'closed',
  closedAt: Timestamp,
  closedReason: 'venue_closed',
  replacedBy: 'gp_ChIJdRefdQsF9YgR3QvN54V6WGc'  // Domaine ATL doc ID
}

// New venue (Domaine ATL)
{
  status: 'unclaimed',
  previousVenue: 'opera-atlanta',
  previousVenueName: 'Opera Atlanta'
}
```

### Script command:
```bash
node importPlaces.js --close --docId="opera-atlanta"
node importPlaces.js --close --docId="opera-atlanta" --replacedBy="gp_xxx"
```

---

## Refresh Mode

The import script can refresh existing venues with updated Google Places data.

### Owner-protected fields (never overwritten on refresh):
`instagram`, `about`, `attributes`, `menuDescription`, `isFeatured`,
`isClaimed`, `claimedBy`, `claimedAt`, `status`, `vibes`, `specialHours`,
`hoursVisible`

### Fields updated on refresh:
`name`, `address`, `phone`, `website`, `hours`, `parking`, `rating`,
`isActive`, `media`, `confidence`

### Script commands:
```bash
node importPlaces.js --refresh                          # all venues
node importPlaces.js --refresh --neighborhood="Midtown" # one neighborhood
```

Refresh skips `closed` and `disabled` venues automatically.
Instagram is skipped during refresh to preserve SerpAPI quota — run
`--instagram-only` separately.

---

## Import Script Reference

Located at: `mobile-app/scripts/importPlaces.js`

```bash
# Import new venues
node importPlaces.js --neighborhood="Midtown"
node importPlaces.js --all

# Refresh existing venues
node importPlaces.js --refresh
node importPlaces.js --refresh --neighborhood="Midtown"

# Instagram lookup (always test first)
node importPlaces.js --instagram-only --test
node importPlaces.js --instagram-only

# Close a venue
node importPlaces.js --close --docId="venue-doc-id"
node importPlaces.js --close --docId="venue-doc-id" --replacedBy="gp_xxx"
```

### Environment variables required (scripts/.env):
```
GOOGLE_PLACES_API_KEY=your_key
SERP_API_KEY=your_key   # optional but recommended
```

### Both files are gitignored:
```
scripts/.env
scripts/serviceAccount.json
scripts/serviceAccountKey.json
```

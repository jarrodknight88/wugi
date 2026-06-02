# Handoff: Wugi VenueScreen v2

**Implemented:** 2026-06-02 against commit `05e4971`.
**Source of truth:** `wugi-design-system/project/ui_kits/consumer-app/VenueScreen.jsx`
in the Claude Design kit (kit hash `PK4z0EAUukDXs0Jfq8iv-Q` and the same
content in the earlier kits `(1)`/`(2)` — the JSX has been stable across
those exports; the difference between them was metadata/system-level docs).

This README closes the gap that caused the v2 redesign to ship without
implementation: prior kit exports contained the redesigned `VenueScreen.jsx`
but **no companion handoff README** alongside Home / Event-Discover /
Discover-Itinerary, so the implementation pass that handled those screens
did not pick up Venue. Future Venue design changes should ship as an updated
copy of this file with the kit, **not** as a code-only PR.

---

## Overview

VenueScreen had a Path 3 baseline (`bcdf36f`, late May) and UAT-V3 polish
(`3a9a280` hero scrim, `a558021` glass-pill top icons, `05fa272` Share →
kebab) but never received the structural visual pass EventScreen got in
`96baf3c` + `803d69a`. v2 closes that gap with seven sub-component blocks
ported from the kit + an additional secondary block carrying useful info
the kit drops by default.

---

## Section structure (top → bottom)

The screen renders, in order:

1. **Hero** — paged photo carousel (aspect 1.2) with the venue name
   overlaid at the bottom (FONTS.display, 34px, -1.2 tracking). Smooth
   bottom scrim (transparent → 0.5 → 0.85 black) covers the whole hero
   so the name + carousel dots stay legible. Top controls: 40×40 BlurView
   pills for Back (left) + ⋮ kebab (right) at `top:64 / left:20 / right:20`,
   matching EventScreen's Wave 1 glass-pill pattern exactly.

2. **Stats trio + category line** — open status (sage green dot) · rating
   (★) · price tier ($/$$/$$$), each in a card chip side-by-side. Real
   data only — chips render only when their backing field is present
   (venue.openStatusHint / venue.rating / venue.priceTier). The kit's
   `VenueStatsBlock` drops these in favor of a category-only line; we
   **keep them** per UAT decision (real data already wired). The category
   line still appears below the trio when `venue.category` is set.

3. **FIND US** — eyebrow + horizontal strip: 64×64 logo box (venue.logoUrl
   if set, else first-two-letter monospace initials) + venue name +
   underlined accent address (tap → onMapPress) + underlined accent phone
   (tap → `tel:` link) + chevron. This is the kit's `VenueContactBlock`
   ported verbatim.

4. **HOURS & INFO** *(secondary)* — eyebrow + card with up to three rows:
   HOURS / WEBSITE / INSTAGRAM, in that order, only rendering rows whose
   data is present. Website + Instagram rows are tappable. **This block
   is not in the kit JSX** — it's our addition to keep useful info on the
   page rather than dropping it (UAT answer #2).

5. **ABOUT THE PLACE** — eyebrow + paragraph (`venue.about`). Just text,
   no info-card rows. Separated from `FIND US` so each block has a single
   clear purpose.

6. **MENU** — engrained eyebrow + "View All →" link (right-aligned, taps
   through to MenuScreen via `onMenuPress`) + a single teaser paragraph.
   Teaser source preference: `venue.menuDescription` → joined
   `venue.menuAttributes` → neutral prompt. Never fabricated. Matches
   EventScreen's `803d69a` "MENU engrained like About" pattern.

7. **WHAT TO EXPECT** — amenities as a 2-column icon+label grid inside a
   single card (`theme.card` background, `theme.border`, 12px radius). Each
   row: 17×17 SVG icon (path from `AMENITY_ICON` map) + label.
   Data source: `venue.amenities[]`, falling back to legacy
   `venue.attributes[]` (same precedence the old pill list used).
   See **Amenity icon map** below for keys + fallback.

8. **HAPPENING HERE · N UPCOMING** — eyebrow + heading "What's on the
   calendar" + horizontal scroller of 200-wide cards. Each card: 110px
   image area with a date badge top-left (10px mono uppercase, parchment
   on translucent dark) over a soft bottom scrim, then title + time
   below. Tap → navigates to that event's detail. Data source: live
   Firestore query for `events` where `venueId == venue.id` and
   `status == 'approved'` (capped at 8 client-side).

9. **GALLERIES · N NIGHTS** — plum eyebrow (#9b59b6) + heading "Nights
   here, captured" + **"All →" link** (right-aligned, only renders when
   there are >4 galleries AND `onAllGalleries` is wired) + **2-col aspect-1
   grid** showing the first 4 galleries. Each tile: full-bleed cover image
   + bottom scrim + `{photoCount} photos` (parchment, FONTS.display 14) +
   `{date}` (60% opacity, MONO 10). Tap → opens the gallery in
   GalleryScreen. The "All →" link routes to `VenueGalleriesListScreen`
   (new — see below).
   Data source: top-level `galleries` collection, `where venueId ==
   venue.id`, sorted by `createdAt` desc client-side.

10. **Sticky CTAs (bottom)** — unchanged from prior Venue. When an active
    ticketed event exists at this venue, the "Get Tickets" button shows
    above the row; the bottom row is Directions (secondary; tap →
    onMapPress) + Reserve (primary, accent fill, accent glow shadow).
    Render conditionally based on data presence.

---

## New screen: VenueGalleriesListScreen

Located at `mobile-app/src/screens/VenueGalleriesListScreen.tsx`.

**Reached from:** the "All →" link on VenueScreen's GALLERIES section
(only renders when a venue has >4 galleries).

**Props:** `{ venueId, theme, onBack, onGalleryPress }`.

**Layout:** Sticky header (back button left, "Galleries" title centered),
then a vertical scroll. Above the grid: plum eyebrow `N NIGHTS · NIGHTS
HERE, CAPTURED` + venue-name heading (loaded from the venue doc on mount).
Below: full 2-col aspect-1 grid of every gallery for the venue. Same tile
anatomy as the inline grid on VenueScreen. Tapping a tile opens the
gallery in the existing GalleryScreen → PhotoViewer flow.

**Routing:** new `NavEntry` variant `{ screen: 'venueGalleries'; venueId: string }`
in `mobile-app/src/types/index.ts`. RootNavigator renders the screen for
this entry and pops on back.

---

## Amenity icon map (locked answers — UAT #1)

Real Firestore `venue.amenities[]` are Title-Case-with-spaces strings.
The kit's `AMENITY_ICON` map is keyed the same way. Exact matches across
the seed data (Teranga, Opium, Vision, etc.):

- `Hookah` · `Bottle Service` · `Reservations` · `Dress Code` — exact ✓
- `Patio` — exact ✓ (Teranga uses `Outdoor Seating` which falls through
  to circle; some other venues have `Patio` exactly)

No exact match (falls through to a generic circle path, per UAT answer #1):

- `Happy Hour`, `Brunch`, `Live DJ`, `Full Bar`, `VIP Tables`, `Dance Floor`,
  `Valet Parking`, `Sports TVs`, `Outdoor Seating`, `Late Night`, etc.

A small `normalizeAmenity()` helper is included as defensive insurance
against future case/punctuation drift (e.g., `"outdoor_patio"` → `"Outdoor
Patio"`). Today's data needs no normalization to hit the exact keys; the
helper is a no-op safety net.

**Future extension:** if specific high-frequency amenities show up
consistently and deserve a custom icon, add a new entry to `AMENITY_ICON`
in `VenueScreen.tsx`. Keep keys Title-Case-with-spaces to match Firestore.

---

## Locked product decisions (from UAT)

These five answers were locked at implementation time and should be
preserved in future revisions unless explicitly re-opened:

1. **Amenity icon keys vs Firestore labels** — port the kit's
   `AMENITY_ICON` map verbatim (Title-Case-with-spaces keys). Add a
   `normalizeAmenity` helper for defensive matching. Misses fall through
   to a generic circle path.

2. **Website / Instagram / Hours disposition** — keep in a **secondary
   `HOURS & INFO` block** below `FIND US`. Don't drop them. Don't fold
   into the kebab menu.

3. **Galleries grid count** — **first 4 inline** in the 2-col aspect-1
   grid + an "All →" link (top-right of the section) when >4 galleries
   exist. Link pushes the new `VenueGalleriesListScreen`.

4. **Figma reconciliation** — skip the Figma round-trip; the kit JSX is
   the source of truth for v2. Reconcile any Figma drift post-launch.

5. **`tweaks` / `amenityStyle` prop scaffold** — dropped entirely. The
   kit's runtime variant-switcher is kit-side tooling; hardcode the
   `icons` style in production.

---

## Hard constraints (preserved during implementation)

- **`VenueIdentityBlock`** and **`useVenueById`** were not touched.
- **`RootNavigator`** routing was extended additively only (new render
  case + new prop pass-through).
- **`types/index.ts`** edit was additive (new `NavEntry` variant).
- **No native libraries** added.
- **No changes to `package.json` / `package-lock.json`** in the app or
  repo root.

---

## Files in this change

- `mobile-app/src/screens/VenueScreen.tsx` — full rewrite to the new
  sectional structure (preserves existing state/effects/hero/sticky
  CTA logic).
- `mobile-app/src/screens/VenueGalleriesListScreen.tsx` — **new**.
- `mobile-app/src/types/index.ts` — additive `NavEntry` variant.
- `mobile-app/src/navigation/RootNavigator.tsx` — import + render case +
  `onAllGalleries` pass-through on VenueScreen.

---

## For future Venue design changes

If Venue gets another redesign:

1. Update the kit's `ui_kits/consumer-app/VenueScreen.jsx`.
2. **Ship this README updated** alongside the JSX, in the kit's
   `project/design_handoff_venue/` directory (or as a new revision of
   this file in the repo).
3. Reference any specific Figma node IDs in the README header.
4. Lock the product decisions explicitly (the "five answers" pattern).
5. Don't ship a code-only PR — the README is what triggers the
   implementation pass on the codebase side.

# Admin Surface Audit — Events / Venues / Series / Galleries / Tickets / Users / Audit Log vs. Current Data Model

**Date:** 2026-09-08
**Requested by:** Jarrod (issue #286, Asana task 1217079542021351)
**Author:** Claude (agent), via 3 parallel code-audit passes + manual verification
**Status:** Deliverable 2 of #286. Deliverable 1 (Events admin MEDIA tab) was found already shipped on `main` — see note at the end.

## Context and method

Classic admin pages under `dashboard/app/dashboard/` predate the venue-intel/pipeline era
and were audited against the current data model as it actually exists in code — not
against `docs/schema.md`, which was confirmed **stale and unreliable** (documents fields
like `photos`, `eventSeriesId`, `claimed` that no longer match any real write path; has no
concept of `vibes`, `tier`, `confidence`, etc.). The one schema source that's mostly
authoritative is `mobile-app/src/types/firestore-v2.ts` (`VenueV2`, `EventV2`, `TicketType`,
`DealV2` + canonical enums) — this audit uses it as the baseline, but calls out several
places where even that file has drifted from what the running system actually does.

Every finding below was verified against actual source (grep + read), not inferred from
docs. Two of the highest-impact claims (`dateISO` never written by the Events admin,
`hasTickets` never reset on ticket-tier delete) were independently re-verified after the
research passes completed.

Severity labels: **Launch-blocking** = actively corrupts data or breaks a user-facing flow
today, silently, for content created/edited through the classic admin. **Post-launch
polish** = real gap or debt, but either has a workaround, is masked by defensive fallback
code, or doesn't affect live data integrity yet.

---

## 1. Events admin (`dashboard/app/dashboard/events/`)

| # | Gap | Evidence | Severity |
|---|---|---|---|
| 1.1 | Status dropdown/filter uses legacy `"pending"` instead of canonical `EventStatus` value `"pending_review"`; canonical `"closed"` is entirely unreachable — no control anywhere sets it, and no Cloud Function does either | `events/page.tsx:19,52,142,212`; `[eventId]/page.tsx:54-58,210,372`; canonical enum + explicit "legacy = bug" comment at `firestore-v2.ts:89-105` | **Launch-blocking** |
| 1.2 | List-page filter tabs do exact-string match on `status` — any event actually carrying canonical `"pending_review"` (written by the scrape transform) never appears under the "pending" tab, only under "All" | `events/page.tsx:125,142` | **Launch-blocking** |
| 1.3 | Vibes picker is hardcoded and non-canonical: mixes `Vibe` values with `Crowd` values (`Hip-Hop`, `LGBTQ+`), and includes `"R&B"` which is in **no** canonical enum at all — writes an undefined value straight into `event.vibes[]`. 8 of 16 canonical vibes (`Chill, Dance, Date Night, Sports, Cultural, Hookah, Lounge, Adult`) are unreachable by admins | `events/page.tsx:18`; `[eventId]/page.tsx:59`; canonical `VIBES` at `firestore-v2.ts:24-28` | **Launch-blocking** |
| 1.4 | `dateISO` is never read or written by either Events admin form — confirmed via grep, zero occurrences. New events created via "+ Add Event" get no `dateISO` at all (drops to a `'9999-99-99'` fallback in sort code); rescheduling an existing/series event's `date` leaves `dateISO` silently stale | `events/page.tsx` (no `dateISO` key in `save()` payload); `[eventId]/page.tsx` (same); consumers: `mobile-app/src/utils/homeFeedSelectors.ts:56-63` ("This Weekend" rail), `VenueScreen.tsx:415`, `VenueEventsListScreen.tsx:58`, `generateSeriesEvents.ts:60-61` | **Launch-blocking** |
| 1.5 | `hasTickets` is set `true` when a ticket tier is created but never reset to `false` when the last tier is deleted — re-verified directly: `deleteTicket()` has no `hasTickets` write at all | `[eventId]/page.tsx:264` (set true), `:268-272` (`deleteTicket`, no reset); CTA gate: `mobile-app/src/screens/EventScreen.tsx:387,838` | **Launch-blocking** (dead "Get Tickets" CTA) |
| 1.6 | Venue change never syncs `address`/`venueLatitude`/`venueLongitude` to the new venue; brand-new events never get geo fields written at all. Feeds Door Access geofencing and any map-based consumer surface | `events/page.tsx:198`; `[eventId]/page.tsx:212` (read-only), `:366`, `:439` (Door geofencing consumes these) | **Launch-blocking** |
| 1.7 | Admin writes only the legacy mirror field `venue`, never canonical `venueName` — backwards from the schema's own documented convention (`venueName` primary, `venue` = mirror). Currently masked by defensive `e.venue || e.venueName` fallbacks throughout the mobile app | `events/page.tsx:198`; `[eventId]/page.tsx:366`; correct pattern already exists at `draft-events/[id]/publish/route.ts:126-127` | Post-launch polish |
| 1.8 | `sourceAttribution` (and `source`/`sourceUrl`) invisible in Events admin — and it turns out attribution is dropped even at the venue-intel *publish* step, before an admin ever sees the event | grep: only appears on venue-intel draft docs (`onVenueIntelApproved.ts:143`, `draft-events/route.ts:124-126`); dropped at `draft-events/[id]/publish/route.ts:124-141` | Post-launch polish |
| 1.9 | `category`, `tags`, `crowd`, and ~15 other real `EventV2` fields (`market`, `schemaVersion`, `isActive`, `confidence`, `isFeatured`, `sortOrder`, `timezone`, `externalId`, `galleryId`, etc.) have zero admin UI. Notably `market` is a **required, non-optional** field on `EventV2` and is never set by the admin | grep across `dashboard/app/dashboard/events/**` — no hits for any of these field names | Post-launch polish |
| 1.10 | Two separate ticket-tier editors (list-page "+ Add Event" modal vs. per-event detail page's Ticket Tiers tab) write incompatible field subsets to the same `ticketTypes` subcollection. The detail-page tab — the one admins actually use post-creation — has no way to create a Free tier, a Table-package tier, set max-per-order, or mark sold_out/cancelled | `events/page.tsx:110` (`isFree/maxPerOrder/tableCapacity/status`) vs. `[eventId]/page.tsx:253-259` (`color/walkUp`, missing the rest) | Post-launch polish |
| 1.11 | `idVerificationThreshold` is real and Door-critical (read by `check-in-app/src/screens/PaymentScreen.tsx`) but is missing from the canonical `EventV2` type entirely — a schema-file gap, not an admin bug | `[eventId]/page.tsx:25,213`; absent from `firestore-v2.ts` | Post-launch polish (schema-doc gap) |
| 1.12 | `TicketType` in `firestore-v2.ts` (fields: `available`, `sortOrder`, comment "unchanged — included for reference") is itself stale vs. production: every real write/read path (both admin editors, `functions/src/tickets/updateInventory.ts`, `functions/src/stripe/createPaymentIntent.ts`, the mobile `TicketSelectionScreen.tsx`) uses `remaining`/`sold`/`isFree`/`walkUp`/`status`/`color`/`maxPerOrder` — fields the "canonical" type doesn't declare at all | `firestore-v2.ts:385-399` vs. `updateInventory.ts:44-56`, `createPaymentIntent.ts:57-58`, `TicketSelectionScreen.tsx:45-52` | **Launch-blocking for doc correctness** — anyone building against `firestore-v2.ts`'s `TicketType` as ground truth (e.g. a new integration) will target a field (`available`) that doesn't exist in any real document |
| 1.13 | Per-event edit page has **zero audit logging** — title/venue/date/status edits, all ticket-tier CRUD (pricing, capacity), all go through with no `logAudit`/`logAuditServer` call anywhere in the file | grep: zero matches in `[eventId]/page.tsx` | **Launch-blocking** (silent writes to money-adjacent fields — ticket price/capacity — with no accountability trail) |

## 2. Series admin (`dashboard/app/dashboard/series/`)

| # | Gap | Evidence | Severity |
|---|---|---|---|
| 2.1 | **`eventSeries` has no canonical type in `firestore-v2.ts` at all**, despite being a stable, actively-used shape (`generateSeriesEvents.ts`, the Series admin, and `draft-events` publish all read/write it). Every other finding below is "vs. what the generator function expects," because there is no authoritative type to check against. Recommend adding an `EventSeriesV2` type as a prerequisite for future series-schema audits | absence in `firestore-v2.ts` | Structural gap |
| 2.2 | Same hardcoded, non-canonical vibes list as Events admin (byte-identical array, including the undefined `"R&B"` value and the Vibe/Crowd taxonomy mix) — copy-pasted into a **third** location, so a fix must land in all three places (or be extracted to one shared constant sourced from `firestore-v2.ts`'s `VIBES`) | `series/page.tsx:51`, identical to `events/page.tsx:18` and `[eventId]/page.tsx:59` | **Launch-blocking** (same as 1.3) |
| 2.3 | Series form has no `category` field; the generator (`generateSeriesEvents.ts:65`) always writes `category: null` on every generated occurrence, permanently | `series/page.tsx` (no field); `generateSeriesEvents.ts:65` | Post-launch polish |
| 2.4 | Editing a series's `venueId` (or other template fields) after creation does **not** retroactively update already-generated future occurrences — only *already-generated* media gets an explicit "changes apply to this occurrence only" style warning; venue/time/age changes get none. Can leave a mix of old-venue and new-venue occurrences live with no admin-visible warning | `series/page.tsx:176-183` (media-only warning documented) | Post-launch polish |
| 2.5 | No ticket-tier / `hasTickets` management on the Series form — `hasTickets` is hardcoded `false` on every generated instance. **This appears intentional** (admins add tickets per-occurrence via Events admin after generation) — flagging so it isn't "fixed" into a footgun, not a bug | `generateSeriesEvents.ts:69` | Note only |
| 2.6 | **Positive finding**: the generator never overwrites an already-generated instance doc (`.set()` only on `plan.toCreate`, existing IDs are always skipped) — so there is no risk of a series regeneration clobbering an admin's manual edits to a past occurrence. The issue's "could clobber on save" concern is resolved for the generator's own write path | `generateSeriesEvents.ts:141-171,188-191` | Resolved, not a gap |
| 2.7 | Series admin has **zero audit logging** on create/update/archive/unarchive/delete | grep: zero `logAudit`/`logAuditServer` matches in `series/page.tsx` | **Launch-blocking** |

## 3. Venues admin (`dashboard/app/dashboard/venues/`)

| # | Gap | Evidence | Severity |
|---|---|---|---|
| 3.1 | Status controls use a non-canonical `"rejected"` value — `VenueStatus` has no `rejected` state (that's only valid for events). The "Reject" button is live and frequently used; a venue "rejected" this way vanishes from every documented status bucket with undefined downstream behavior. The two Venues admin surfaces (list vs. detail) also disagree with each other on which status options are even offered, and both are missing `disabled` and/or `closed` from their dropdowns | `venues/page.tsx:13-20,111,148,246-249`; `[venueId]/page.tsx:328`; canonical `VenueStatus` at `firestore-v2.ts:94-99` | **Launch-blocking** |
| 3.2 | Classic "+ Add Venue" produces a schema-incomplete v1-shaped doc: no `tier`, `isClaimed`, `confidence`, `source`, `location` (GeoPoint), `primaryCategory`, or `schemaVersion`. Contrast with the venue-intel `create-venue` pipeline, which produces a reasonably complete v2 doc. This is the direct, concrete evidence for the issue's premise that classic admin predates the v2 era | `venues/page.tsx:66-81` vs. `dashboard/app/api/venue-intel/create-venue/route.ts` + `dashboard/lib/placesImport.ts` | **Launch-blocking** |
| 3.3 | Venues admin writes flat `venueLatitude`/`venueLongitude` fields (used for Door PIN geofencing) but **never** the canonical `location: GeoPoint` field that the mobile app's ride/distance features actually read. Any address edit made in the classic admin — including for a venue-intel-imported venue that *does* have `location` — leaves `location` silently pointing at the old address forever | `[venueId]/page.tsx:264-282,188`; consumers: `VenueScreen.tsx:658-660`, `EventScreen.tsx:603`, `DealScreen.tsx:181`; contrast `placesImport.ts:386` (writes both) | **Launch-blocking** |
| 3.4 | Vibe/category picklists (`MVIB`/`MCATS`) don't match canonical `VIBES`/`PRIMARY_CATEGORIES` — only 7/16 vibes and 4/11 categories match exactly; the rest are invented (`"Sports Bar"`, `"EDM"`, `"Event Space"`) or near-misses that fail `isPrimaryCategory()`. Both admin surfaces write only the legacy free-text `category` mirror and **never** the canonical `primaryCategory`/`subcategories`/`googleTypes` fields at all | `venues/page.tsx:171-172,203-206,262-274`; canonical enums `firestore-v2.ts:24-35`; grep confirms zero `primaryCategory` occurrences under `dashboard/app/dashboard/venues/` | **Launch-blocking** |
| 3.5 | No admin UI anywhere shows or lets staff change `tier`, `isClaimed`, `claimedBy`, `claimedAt`, or `confidence`/`confidence.breakdown` after venue creation. Since `confidence` gates auto-publish into `pending_review`, a moderator reviewing that queue currently has **no visibility into why a venue is pending** or which fields are low-confidence — they approve/reject blind | grep: zero matches under `dashboard/app/dashboard/venues/`; only ever set at creation time (`placesImport.ts`, `create-venue/route.ts:120-126`) | **Launch-blocking** (moderation queue has no signal) |
| 3.6 | `attributes`, `crowd`, `isTestVenue`, `isActive`, `popularityScore`, `chargebackBalance`, `slug`, `googlePlaceId` have zero admin edit path; `neighborhood` is free-text with no validation against the canonical `NEIGHBORHOODS` list | grep: zero matches | Post-launch polish |
| 3.7 | `heroImage`/`heroSelectedBy`/`heroSelectedAt` are actively written by the venue Media tab but absent from the `VenueV2` type; `venueLatitude`/`venueLongitude`/`reservationUrl` are likewise real and load-bearing (Door geofencing, mobile Reserve button) but undeclared in `VenueV2` — schema-file drift, not an admin bug | `dashboard/app/api/venues/[venueId]/media/route.ts:184-190`; absent from `firestore-v2.ts` | Post-launch polish (schema-doc gap) |
| 3.8 | Dead code: the list page's `openEdit`/edit-modal path is defined but never invoked (the "Edit" button navigates to the detail page instead); if ever reconnected it would silently null out `phone/website/instagram/about/vibes` on save since `openEdit` seeds those as blank | `venues/page.tsx:60-64` (defined, never called) | Post-launch polish (cleanup) |
| 3.9 | Per-venue edit page (including Stripe/payout fields on the Payments tab) has **zero audit logging** — contrast with the Venues *list* page, which does log create/status-change | `[venueId]/page.tsx` — single `updateDoc` at line 188, no `logAudit`/`logAuditServer` anywhere in the file; list page logs at `venues/page.tsx:73,76,85` | **Launch-blocking** |
| 3.10 | Minor/cosmetic: the main dashboard home's "pending events" stat tile filters on legacy `status === "pending"`, a value the schema header says was fully remapped in production — this tile is very likely stuck at 0 | `dashboard/app/dashboard/page.tsx:43` | Post-launch polish |

## 4. Galleries admin (`dashboard/app/dashboard/galleries/`)

There are **two entirely separate, unrelated "gallery" collections** in this codebase, and the admin page only knows about one of them.

| # | Gap | Evidence | Severity |
|---|---|---|---|
| 4.1 | The admin Galleries page correctly reads `eventGalleries` (the Wugi Lens photographer pipeline — created by a Cloud Function on first device upload) and its "View on wugi.us" links resolve correctly. But it is **read-only**: no create/edit/delete, no way to change a gallery's `status` (a non-`"live"` state exists in the data model with no admin action to ever set or clear it) | `dashboard/app/dashboard/galleries/page.tsx` (whole file has no write path); `functions/src/lens/ingestLensUpload.ts:140-164` | Post-launch polish |
| 4.2 | A second, older collection — flat `galleries` (type `GalleryDoc`, `mobile-app/src/types/index.ts:38-53`) — is **actively read by the consumer app** (`EventScreen` via `useEventGalleriesByEventId`, `firestoreService.ts` `getGalleryById`/`getGalleriesByEvent`/`getGalleriesBySeries`) but is **only ever written by one-off seed scripts**, and the admin Galleries page has zero visibility into it — can't list, inspect, or fix a broken event→gallery link without a script or console edit | `mobile-app/src/hooks/useEventGalleriesByEventId.ts`; writers: `scripts/seed-fifa-gallery-images.js` etc.; no dashboard reference anywhere | Post-launch polish, escalates to launch-blocking if any near-term launch event depends on a seeded `galleries` doc that needs a fix |

## 5. Tickets admin (`dashboard/app/dashboard/tickets/`)

| # | Gap | Evidence | Severity |
|---|---|---|---|
| 5.1 | Despite the nav label "Tickets," this page is actually an **Orders/passes viewer** — it reads root `orders` and `passes` collections, not `ticketTypes`. Neither `orders`, `passes`, nor the door walk-up model (`events/{id}/tickets`) appear anywhere in `firestore-v2.ts` — a documentation gap on top of the admin-page gap | `dashboard/app/dashboard/tickets/page.tsx:55-86`; absent from `firestore-v2.ts` | Post-launch polish (docs) |
| 5.2 | There are **three separate ticket-sale data models** in this codebase (`ticketTypes` tier config, `orders`/`passes` online sales, `events/{id}/tickets` door walk-ups) and this page shows only the middle one — per an explicit comment in `functions/src/orders/refundTicketOrder.ts:11-14`, door walk-up sales are "not surfaced on the dashboard Tickets page" at all. A founder auditing "all ticket sales" from this page will silently miss walk-up revenue | `refundTicketOrder.ts:11-14` | Post-launch polish |
| 5.3 | `ticketUrl`/`ticketingProvider` (real `EventV2` fields) are fully dead — written only by a seed script, never read by any mobile screen, dashboard page, or function. The "Get Tickets" CTA always routes to the app's own internal purchase flow | `mobile-app/scripts/seed-wugi.js:298`; `RootNavigator.tsx:612,645` | Post-launch polish |
| 5.4 | The events-list ticket-tier create modal writes a *different* field set than the per-event detail page's tab (see 1.10/1.12) — restated here because it's the same root cause as this section's schema-drift finding: `firestore-v2.ts`'s `TicketType` type doesn't match either admin surface | see 1.12 | See 1.12 |

## 6. Users admin (`dashboard/app/dashboard/users/`)

| # | Gap | Evidence | Severity |
|---|---|---|---|
| 6.1 | The same `users/{uid}` collection serves **both** consumer mobile accounts and dashboard staff. The admin Users page queries with no `role` filter and no limit — every mobile signup shows up in the staff table (as role "Unknown", since `ROLE_INFO` has no `consumer` entry), and the `onSnapshot` is unbounded over what will become a large consumer collection | `dashboard/app/dashboard/users/page.tsx:59-69,14-22`; consumer writer: `functions/src/users/onUserCreated.ts:28-47` | **Launch-blocking** (scale/cost + real UX confusion between staff and consumer rows) |
| 6.2 | "Deactivate" only sets `active: false` on the user doc, which is a purely **cosmetic** action — grepped the whole repo: no dashboard auth gate, no Cloud Function, and no Firestore rule anywhere checks `users/{uid}.active` for dashboard or mobile access (only unrelated `active` fields on Door PINs and Lens devices are actually enforced). A deactivated staffer keeps full dashboard access until their Firebase Auth account is separately disabled | `dashboard/app/dashboard/users/page.tsx:97-104`; `dashboard/context/AuthContext.tsx:105` (gates on `role` only); `firebase/firestore.rules` (no `active` reference) | **Launch-blocking (security)** |
| 6.3 | No UI to edit an existing user's `role`/`venueIds`/`eventIds`/`tableAccess` — the `editUser` state is declared and reset but never wired to any modal or button. Activate/Deactivate is the only post-creation action available | `dashboard/app/dashboard/users/page.tsx:39,82` (dead state, no call sites) | Post-launch polish |
| 6.4 | No canonical `User`/`UserProfile` type exists anywhere in `mobile-app/src/types` — the only concrete definition of the consumer-user doc shape is the ad-hoc object literal in `onUserCreated.ts`. Root cause of 6.1/6.2 being invisible to anyone auditing only the "canonical" schema file | grep: zero matches for a user type export | Post-launch polish (docs) |

## 7. Audit Log (`dashboard/app/dashboard/audit/`)

| # | Gap | Evidence | Severity |
|---|---|---|---|
| 7.1 | **Naming collision, not the same system**: the Audit Log page reads root `auditLogs` (human admin actions, written by `dashboard/lib/auditLog.ts` / `serverAuditLog.ts`). The `VenueAuditLog` type documented in `firestore-v2.ts:282-293` is a completely different thing — a scrape-pipeline data-provenance/diff log at `venues/{venueId}/audit/{logId}`, written only by the scrape transform script. The canonical schema file documents the wrong "audit log" relative to what the admin page actually shows | `dashboard/app/dashboard/audit/page.tsx:26`; `firestore-v2.ts:282-293`; writer: `mobile-app/scripts/scrape/03-transform-and-write.js` | Post-launch polish (docs/naming) |
| 7.2 | **Biggest cross-cutting finding of this whole audit**: cross-referencing every Firestore write in every admin surface against `logAudit`/`logAuditServer` call sites — the per-event edit page (all field edits **and** all ticket-tier CRUD — pricing, capacity), the entire Series admin (create/update/archive/delete), and the per-venue edit page (including Stripe/payout fields) have **zero audit logging**. By contrast, the Venues *list* page, Events *list* page, Users, Tickets (refunds), Deals, and Itineraries all log correctly. See table below | see 1.13, 2.7, 3.9 for the three offending surfaces individually | **Launch-blocking** |
| 7.3 | Where logging does happen, entries carry no before/after diff — just `{adminId, adminEmail, action, targetId, targetName, timestamp}`. Contrast with the (unrelated) `VenueAuditLog` type's `diff: Record<field, {from,to}>` shape, which the human-audit log doesn't replicate | `dashboard/lib/auditLog.ts`; `serverAuditLog.ts` | Post-launch polish |

**Audit-logging coverage matrix** (✅ = has `logAudit`/`logAuditServer` calls, ❌ = none found):

| Surface | Coverage |
|---|---|
| Venues — list (create/status) | ✅ |
| Venues — detail/edit (incl. Payments tab) | ❌ |
| Events — list (create/update/status) | ✅ (but bundled ticket-tier writes on create are not separately logged) |
| Events — detail/edit (incl. all ticket-tier CRUD) | ❌ |
| Series — all mutations | ❌ |
| Users — create/deactivate | ✅ |
| Tickets — refund | ✅ |
| Deals — create/update/delete | ✅ |
| Itineraries — create/update/archive | ✅ |
| venue-intel / draft-events API routes | ✅ |

---

## Cross-cutting themes (read this before the fix list)

1. **The canonical status enums (`EventStatus`, `VenueStatus`) were migrated in the scrape
   pipeline but never carried over to the classic admin pages.** Both Events and Venues
   admin UIs still offer/write legacy or invented status values (`"pending"`,
   `"rejected"` on venues) that the schema file explicitly documents as bugs. This is the
   single highest-value fix: it's mechanical (swap dropdown option lists + filter-tab
   values), low-risk, and currently causes events/venues to silently fall through
   filters or vanish from every documented status bucket.
2. **Vibes taxonomy has drifted into three independently-hardcoded, non-canonical copies**
   (Events list, Events detail, Series) that mix `Vibe`/`Crowd`/`Attribute` values and
   include at least one fully-undefined value (`"R&B"`). Fix once, in one shared constant
   imported from `firestore-v2.ts`'s `VIBES`, and it fixes all three surfaces.
3. **Geo/location fields have a three-way split** (`location: GeoPoint` vs. flat
   `venueLatitude`/`venueLongitude` vs. `address`) with no single write path keeping all
   three in sync. This affects both Venues and Events admin and quietly breaks
   ride/distance and Door-geofencing features for anything touched by classic admin.
4. **`firestore-v2.ts` itself has drifted from production in several places** (`TicketType`
   shape, missing `EventSeriesV2` type entirely, missing `heroImage`/`venueLatitude`/
   `idVerificationThreshold`/`reservationUrl`, undocumented `orders`/`passes`/`auditLogs`/
   `galleries` collections). Recommend a follow-up pass dedicated to reconciling this file
   with reality — several findings above exist only because there's no ground truth to
   check the Series/Tickets/Users/Audit surfaces against.
5. **Audit logging is inconsistent by surface, not by design** — it's present everywhere
   admins interact with venues/events *lists*, and absent everywhere they interact with
   individual venue/event *detail* pages or the Series admin, which is exactly where the
   money-adjacent edits (ticket pricing/capacity, Stripe/payout config) actually happen.

---

## Prioritized fix list

### Escalate to Jarrod now (launch-blocking; per issue instructions, anything flagged here should not wait for post-freeze)

1. Events/Venues status dropdowns and filters use legacy/invented values instead of the
   canonical enum (§1.1, 1.2, 3.1) — events/venues can be set to statuses that make them
   silently vanish from consumer surfaces or moderation queues.
2. `dateISO` is never written by the Events admin on create or reschedule (§1.4) —
   silently breaks "This Weekend" and sort ordering for every manually-created or
   rescheduled event.
3. `hasTickets` never resets to `false` after the last ticket tier is deleted (§1.5) —
   live dead-end "Get Tickets" CTA on events with nothing to sell.
4. Venue/event geo fields never sync on edit or venue change (§1.6, 3.3) — silently wrong
   data feeding Door geofencing and ride/distance features.
5. Vibes taxonomy is non-canonical across 3 admin surfaces and writes at least one
   undefined value straight into production (§1.3, 2.2).
6. Classic "+ Add Venue" produces a schema-incomplete doc relative to the venue-intel
   pipeline (§3.2); classic Venues admin has no `primaryCategory`/`subcategories` field at
   all (§3.4).
7. Moderators reviewing the `pending_review` venue queue have zero visibility into
   `confidence`, `tier`, or claim state (§3.5) — approving/rejecting blind.
8. "Deactivate user" is cosmetic — no enforcement anywhere (§6.2); Users admin mixes
   consumer accounts into the staff table with an unbounded, unfiltered query (§6.1).
9. Zero audit logging on per-event edits (incl. ticket pricing/capacity), the entire
   Series admin, and per-venue edits (incl. Stripe/payout fields) (§1.13, 2.7, 3.9, 7.2).
10. `firestore-v2.ts`'s `TicketType` type doesn't match any real write/read path in
    production (§1.12) — a correctness risk for any future integration built against it
    as "the" schema.

### Post-freeze backlog (real gaps, not urgent)

- Reconcile `firestore-v2.ts` with production: add `EventSeriesV2`, fix `TicketType`,
  add missing fields (`heroImage`, `venueLatitude`/`venueLongitude`, `idVerificationThreshold`,
  `reservationUrl`), document `orders`/`passes`/`auditLogs`/`galleries` collections.
- `venue`/`venueName` mirror direction is backwards from documented convention (§1.7).
- `sourceAttribution` invisible in Events admin, and dropped at publish time regardless (§1.8).
- No admin UI for `category`/`tags`/`crowd`/`market`/and ~15 other real `EventV2` fields (§1.9).
- Two incompatible ticket-tier editors; detail-page tab can't create Free/Table tiers (§1.10).
- Series template edits (venue, time, age) don't retroactively update already-generated
  future occurrences, with no warning (§2.4).
- Galleries admin is read-only for `eventGalleries` and has zero visibility into the
  separate, still-live-read `galleries` collection (§4.1, 4.2).
- Tickets admin doesn't surface door walk-up sales or clarify it's an orders view, not a
  ticket-type view (§5.1, 5.2); dead `ticketUrl`/`ticketingProvider` fields (§5.3).
- No UI to edit an existing user's role/venue/event assignments (§6.3); no canonical
  `User` type documented anywhere (§6.4).
- `VenueAuditLog` naming collision with the actual admin audit log is confusing (§7.1);
  audit entries carry no before/after diff (§7.3).
- Dead `openEdit` code path in Venues list (§3.8); legacy `"pending"` stat tile on the
  dashboard home page (§3.10).

---

## Note on Deliverable 1 (Events admin MEDIA tab)

This audit's build deliverable — an Events admin MEDIA tab reusing the shared media
picker + rights-badge/staged-asset UI plus a plain file-upload path — was found **already
implemented on `main`** at the time this audit started (no code changes made in this PR):

- `dashboard/app/dashboard/events/[eventId]/page.tsx` — MEDIA tab wired in alongside
  Event Info / Door Access / Ticket Tiers.
- `dashboard/app/dashboard/events/[eventId]/EventMediaPanel.tsx` — reuses the shared
  `MediaManager` component, shows staged venue assets with rights badges (defaulting
  unmatched assets to `wugi_partner` since anything already saved already passed a prior
  confirm gate), and wires a plain file-upload control through `MediaManager`'s `upload`
  prop.
- `dashboard/app/api/events/[eventId]/upload/route.ts` — direct staff upload, gated by
  `requireEventWrite` (admin-only), writes via the Admin SDK to
  `published-media/uploads/events/{eventId}/{uuid}.{ext}` — a path Storage rules
  (`firebase/storage.rules:83-86`) explicitly deny to client writes (`allow write: if
  false`), so the only write path is this server route's admin check.
- `dashboard/app/api/events/[eventId]/media/route.ts` — PATCH save, materializes staged
  signed URLs before they land in Firestore and syncs `events.coverImage`.

No further build work is needed for Deliverable 1 unless a gap is found in a future
pass; this audit surfaced none.

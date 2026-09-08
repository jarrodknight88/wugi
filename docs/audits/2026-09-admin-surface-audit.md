# Admin Surface Audit — September 2026

Executed for Asana task [1217079542021351](https://app.asana.com/1/1208137481227174/project/1214022910398008/task/1217079542021351) / issue #286, under the **investor-demo-readiness** lens per Jarrod's 9/8 scope amendment (not launch-date). Read-only audit — no functional code changes in this PR.

**Scope amendment applied:** the original task's Deliverable 1 (Events admin Media tab) is already shipped (`EventMediaPanel.tsx`, merged 8/2; upload endpoint, merged 8/4). This report verifies it against the original intent and folds it into the audit below instead of rebuilding it. Deliverable 2 — this report — is now the entire task.

Canonical schema reference used throughout: `mobile-app/src/types/firestore-v2.ts` (`EventV2`, `VenueV2`, `VIBES`, `PRIMARY_CATEGORIES`, `EventStatus`, `VenueStatus`). Where classic admin pages diverge from it, that's called out explicitly.

## Result: Deliverable 1 confirmed shipped and solid. 5 P0s, 10 P1s, 6 P2s found across the seven classic pages — the standout pattern is that the *current, live* edit surfaces (event/venue detail pages, the whole Series page) silently bypass the audit trail, and there are three different, none-canonical hardcoded `vibes` pickers scattered across Events/Venues/Series.

---

## Deliverable 1 — Events Media tab (verification only)

`dashboard/app/dashboard/events/[eventId]/page.tsx` has **five** tabs — Event Info / **Media** / **Photos** / Door Access / Ticket Tiers (`page.tsx:282-288`) — richer than the three named in the original 7/31 task notes. Confirmed against the original intent:

| Requirement | Status | Where |
|---|---|---|
| Reuses picker components + media-edit API | ✅ | `EventMediaPanel.tsx` shares `MediaManager.tsx` (`components/MediaManager.tsx`) with `VenueMediaPanel.tsx`, `SeriesMediaManager.tsx`, and venue-intel's `DraftEventsPanel.tsx` — same component, not a copy. No standalone `VenueHeroPicker`/`GalleryPicker` components exist under that name; the shared `MediaManager` is the actual generalization, which satisfies the intent. |
| Staged venue assets (venue hero, galleries) | ✅ | `GET /api/events/[eventId]/venue-assets` (`dashboard/lib/venueAssetsForVenue.ts`) — same staged-asset lookup shared with Series and draft-events pickers. |
| Rights badges + unverified confirm | ✅ | `rightsStatus` per asset (`EventMediaPanel.tsx:65-77`), risky-save confirm gate (`confirmedRisky` → `confirmedUnverifiedRights`, `EventMediaPanel.tsx:83-88`), rendered via `MediaThumb.tsx`'s badge component. |
| Plain file upload for manually-created events | ✅ | `POST /api/events/[eventId]/upload` (`dashboard/app/api/events/[eventId]/upload/route.ts`) — 60MB cap, jpeg/png/webp/gif/mp4, admin-write-only (`requireEventWrite`), audited (`logAuditServer`, `route.ts:55-61`). |
| Admin-only Storage rules | ✅ (different path than notes assumed) | Lands at `published-media/uploads/events/{eventId}/{uuid}.{ext}`, not a literal `events-media/` prefix — `firebase/storage.rules` scopes `published-media/**` to `allow write: if false` (Admin SDK/server-route only), `allow read: if true` (`storage.rules:83-86`). Functionally equivalent to what the notes asked for, just a different naming convention. |

**Gaps found (folded into Events findings below, P1/P2):** event *creation* still doesn't get any of this — new events are created via a raw "Cover Image URL" text field (see Events → P1-2). The resulting Bronze-upload gallery (`galleryId`) is never cross-linked back from the event page (see Events → P2-3).

---

## Events (`dashboard/app/dashboard/events/`)

**Reads/writes:** `events/{id}` (title, venue, venueId, date, time, age, about, status, hasTickets, vibes, idVerificationThreshold, media, seriesId) + `events/{id}/ticketTypes/{id}`. Two independent UIs write these: the list page's create/edit modal (`page.tsx`) and the detail page (`[eventId]/page.tsx`).

- **P0 — `hasTickets` is never cleared.** `deleteTicket()` (`[eventId]/page.tsx:268-272`) only guards against deleting a tier with sold tickets; nothing ever sets `hasTickets: false` back, whether via the admin or any Cloud Function (grepped `functions/src` — the only writer is `generateSeriesEvents.ts` defaulting new docs to `false`). Delete an event's only ticket tier and `hasTickets` stays `true` forever. Mobile app gates its "Get Tickets" CTA purely on `hasTickets === true` (`EventScreen.tsx:387`, and 7 other screens) — so a demo event with zero tiers can still show a live "Get Tickets" button that leads nowhere.
- **P0 — `dateISO` is never written or updated by the classic admin.** `EditForm`/`saveEdits()` (`[eventId]/page.tsx:33-37, 241-250`) and the list-page create/edit form (`page.tsx:23, 90-118`) only read/write `date` (display string) — `dateISO` is never touched. `mobile-app/src/utils/homeFeedSelectors.ts:56-64` explicitly excludes any event with no `dateISO` from "This Weekend," and other dateISO-keyed feed placements behave the same way. **Any event created purely through classic Events admin never appears in date-scoped feed sections; rescheduling an existing event via the dashboard silently desyncs it from the app's date-based placement.** This is the single most demo-risky finding in this audit — "let me create an event and show it in the app" is exactly the investor-demo path this breaks.
- **P0 — vibes picker doesn't match the app** (cross-cutting, detailed below) — `VIBES` constant at `[eventId]/page.tsx:59` and `page.tsx:18`, identical 11-item list, none of which is the canonical 16-item `Vibe` enum.
- **P0 — audit trail gap on the live edit surface** (cross-cutting, detailed below) — `setStatus()` (`[eventId]/page.tsx:274-276`), `saveTicket()`/`deleteTicket()` (`:252-272`) never call `logAudit`.
- **P1 — two incompatible ticket-tier schemas.** The list page's dead-but-present edit modal (`openEdit`/`modal==="edit"`, `page.tsx:70-88`) and its reachable create path both write `isFree`, `tableCapacity`, `maxPerOrder`, `status: on_sale/sold_out/cancelled` — fields the live detail-page `TicketModal`/`saveTicket()` (`[eventId]/page.tsx:78-181, 252-266`) never reads, writes, or displays (it uses `active`, `walkUp`, `color`). A VIP table tier created via "+ Add Event" with `tableCapacity` set becomes invisible the moment it's edited from the detail page. Worse: `openEdit`'s `save()` path (`page.tsx:110`) sets `sold: 0, remaining: tt.capacity` unconditionally — if that dead edit-modal is ever wired back up, editing an existing tier through it would silently wipe sold-ticket counts. The "Edit" button on the list (`page.tsx:164`) actually calls `router.push` to the detail page, so `openEdit`/`modal==="edit"` (`page.tsx:70-88`) is currently unreachable dead code.
- **P1 — creation still bypasses the Media tab's whole rights/staging system.** The list page's Add Event modal (`page.tsx:224-227`) collects media as a single raw "Cover Image URL" paste — no staged assets, no video, no rights badges. You have to save the event first, then switch to the (now-verified-solid) Media tab. This only half-closes the gap Deliverable 1 was built to close.
- **P1 — `sourceAttribution` / `isSeriesAnchor` invisible**, exactly as Jarrod's 7/31 note flagged. Both exist on `EventV2` and are written by the venue-intel pipeline (`functions/src/intel/onVenueIntelApproved.ts`, `dashboard/app/api/draft-events/**`), but neither classic Events page reads or displays them. An admin looking at a scraped event in the classic list has no way to tell where it came from or whether it anchors a series.
- **P2 — canonical `EventStatus.closed` is dead everywhere.** Nothing sets it — not classic admin (`status` select only offers `pending/approved/rejected`, `[eventId]/page.tsx:372`, `page.tsx:212`), not any Cloud Function (grepped `functions/src`). `pending` (vs. canonical `pending_review`) is at least self-consistent today: the venue-intel publish path writes straight to `status: "approved"` (`draft-events/[id]/publish/route.ts:134`), so no live event ever actually holds `pending_review` — this is a naming mismatch against the type, not an active query bug.
- **P2 — Bronze-upload gallery isn't cross-linked.** `EventBronzeUploadPanel.tsx`'s "Photos" tab shows link/upload stats and a `galleryId`, but never links to the resulting `eventGalleries` doc — you have to go find it in the separate Galleries page.

## Venues (`dashboard/app/dashboard/venues/`)

**Reads/writes:** `venues/{id}` — the detail page (`[venueId]/page.tsx`) covers Info (name/category/address/neighborhood/contact/reservationUrl/about/status/isFeatured), Media (`VenueMediaPanel.tsx`), Door Access, Tables, and Payments & ID (paymentDescriptor, idVerificationThreshold, stripeConnectAccountId) — this is the most complete of the seven pages against the canonical `VenueV2` shape for the fields it does touch.

- **P0 — existing venues can never have `vibes` edited.** The only vibes UI anywhere in Venues admin is the list page's create/edit modal (`MVIB` picker, `page.tsx:171, 260-274`), but its "Edit" button (`page.tsx:146`) does `router.push` to the detail page, not the modal — `openEdit`/`modal==="edit"` (`page.tsx:60-64`) is unreachable dead code, identical pattern to Events. The detail page's Info tab (`[venueId]/page.tsx:249-357`) has **no vibes UI at all**, despite reading `vibes` into state (`page.tsx:172`). Once a venue exists, its vibes are frozen at whatever was set at creation (or blank, for anything created via venue-intel).
- **P0 — three-way vibes-taxonomy mismatch** (cross-cutting, detailed below) — `MVIB` at `page.tsx:171` is a *third*, distinct 16-item list, overlapping neither the canonical `VIBES` enum nor the Events/Series admin's 11-item list.
- **P0 — audit trail gap on the live edit surface** (cross-cutting) — `[venueId]/page.tsx`'s `handleSave()` (`:183-196`) never calls `logAudit`; only the list page's create/edit-modal path and `setStatus()` do, and edit is dead code (above).
- **P1 — `isTestVenue` has zero presence anywhere in `dashboard/`** (confirmed via repo-wide grep). Seed/QA venues are indistinguishable from real ones in the Venues list and can't be filtered out or flagged from the UI — a real risk of a stray test venue showing up in front of an investor.
- **P1 — category taxonomy is untethered from the schema.** The list-page create modal's `MCATS` (`page.tsx:172`) is a 9-item list that partially overlaps but doesn't match canonical `PRIMARY_CATEGORIES` (e.g. "Live Music Venue" vs. canonical "Live Music"; missing Comedy/Adult/Brewery-Distillery/Cafe/Hotel Bar-Rooftop Pool). The detail page's Category field (`[venueId]/page.tsx:256-259`) is unconstrained free text. None of `primaryCategory`, `subcategories`, `attributes`, `crowd`, or `googleTypes` — the actual venue-intel-era taxonomy fields — are visible or editable anywhere in classic Venues admin.
- **P2 — status filter buttons omit two statuses the edit form can set.** List page filter row (`page.tsx:111`) offers `all/approved/pending_review/unclaimed/rejected`; the edit form's own status select (`page.tsx:246`) additionally allows `closed`/`disabled` — you can set those from the modal but can never filter the list down to them.

## Series (`dashboard/app/dashboard/series/`)

**Reads/writes:** `eventSeries/{id}` (single combined list+edit page, no nested detail route) — already handles legacy/dual schema gracefully (`dayOf()`/`freqOf()` helpers at `page.tsx:49-50` read either the old flat `day`/`frequency` fields or the newer `recurrence` map), which is a genuinely good piece of engineering worth calling out as *not* a gap.

- **P0 — same vibes-picker mismatch** (cross-cutting) — `VIBES` at `page.tsx:51` is the byte-for-byte same wrong 11-item list as the Events pages.
- **P0 — no audit logging at all.** `page.tsx` never imports `logAudit` — create, edit, archive/unarchive, delete, and manual "Generate" all leave zero audit trail (cross-cutting, detailed below).
- **P1 — `promoterId` is a write-blind field.** It's declared on the `Series`/`SF` types (`page.tsx:20, 32`), defaulted (`:37`), round-tripped through `openEdit()` (`:145`) and `save()` (`:166-174`), but **no `<input>` for it exists anywhere in the modal** — it can never actually be set from the dashboard.
- **P1 — series-level media edits are explicitly non-retroactive** (by design — `page.tsx:375` hint text and the `save()` comment at `:176-184` are candid about this): editing a series' cover/media only affects future-generated occurrences, not already-generated upcoming ones. Reasonable tradeoff, but a live demo trap ("I just changed the series photo" won't show up on the next occurrence if it's already been generated).

## Galleries (`dashboard/app/dashboard/galleries/`)

**Reads/writes:** `eventGalleries/{id}` — read-only display (eventTitle, venueName, photoCount, status, createdAt), no detail route.

- **P1 — no moderation actions of any kind.** The only interactive element is an outbound link to the public `wugi.us/gallery/{id}` page (`page.tsx:144-162`). There's no way to unpublish a gallery, remove an individual photo, or otherwise intervene from the dashboard if something inappropriate needs pulling before a demo.
- **P2 — no click-through to the source event.** `eventTitle`/`venueName` are plain text, not linked back to `/dashboard/events/{id}`.

## Tickets (`dashboard/app/dashboard/tickets/`)

**Reads/writes:** `orders/{id}` (read), `events/{id}` (read, for display join), `passes/{id}` (read, for check-in counts), refunds via the `refundTicketOrder` callable. This is the tightest page against its data model of the seven — refund eligibility mirrors `functions/src/orders/refundTicketOrder.ts`'s `REFUNDABLE_STATUSES` explicitly in a comment (`page.tsx:18-20`), role-gating (`super_admin`/`moderator`) is enforced both client- and server-side, and the checked-in-tickets warning before a refund is a nice touch. No P0/P1 findings.

- **P2 — no click-through from an order's Event cell to `/dashboard/events/{id}`.**

## Users (`dashboard/app/dashboard/users/`)

**Reads/writes:** `users/{uid}` (role, venueIds, eventIds, tableAccess, active) via `createDashboardUser` callable (create) and direct `updateDoc` (active toggle only).

- **P1 — no way to edit an existing user's role/assignments.** The only per-row action is Activate/Deactivate (`page.tsx:173-181`); there is no edit modal for role, `venueIds`, `eventIds`, or `tableAccess` after creation. Reassigning a venue_staff member to a different venue, or promoting someone, has no dashboard path today — the only workaround is deactivate-and-recreate (which mints a new uid, discarding the old one's audit history/references) or a direct Firestore edit. Would visibly stall a "can you change what this person can access" ask mid-demo.

## Audit Log (`dashboard/app/dashboard/audit/`)

**Reads:** last 100 docs from `auditLogs`, ordered by `timestamp desc`. The page itself is a faithful, simple reflection of whatever lands in that collection — the real problem is what's missing upstream.

- **P0 — systemic blind spot: the pages admins actually use today don't write to it.** Cross-referencing every `updateDoc`/`setDoc`/`deleteDoc`/callable-invocation across the seven pages against `logAudit`/`logAuditServer` usage:

  | Page | Writes that ARE logged | Writes that are NOT logged |
  |---|---|---|
  | Events | list-page create/edit-modal save, list-page `setStatus` (`page.tsx:103,106,122`) — **both effectively dead/rarely-hit**, since "Edit" navigates to the detail page instead | detail-page `setStatus`, `saveTicket`, `deleteTicket` (`[eventId]/page.tsx:241-276`) — **the actual live edit path** |
  | Venues | list-page create/edit-modal save, list-page `setStatus` (`page.tsx:73,76,85`) — same dead-edit-path caveat | detail-page `handleSave` for Info/Media/Payments (`[venueId]/page.tsx:183-196`) — **the actual live edit path** |
  | Series | — | everything: create, edit, archive/unarchive, delete, generate (`page.tsx` never imports `logAudit`) |
  | Events/Venues media & upload API routes | ✅ all of them (`logAuditServer`, e.g. `events/[eventId]/upload/route.ts:55-61`) | — |
  | Tickets (refunds), Users (create/update/deactivate) | ✅ all reachable actions | — |

  In practice, the Audit Log today can answer "who uploaded this photo" or "who refunded this order," but **not** "who changed this ticket's price," "who approved this event," or "who edited this venue's info" — the exact questions a demo audience is most likely to ask, and the exact actions admins actually perform through the live UI.
- **P2 — Target column is a plain string**, no link back to the affected event/venue/user (`page.tsx:72`).

---

## Cross-cutting findings

**Three non-canonical, mutually-inconsistent `vibes` pickers.** The canonical `Vibe` enum (`mobile-app/src/types/firestore-v2.ts:24-29`) is `Boujee, Divey, Speakeasy, High Energy, Rooftop, Late Night, Chill, Dance, Live Music, Date Night, Sports, Brunch, Cultural, Hookah, Lounge, Adult` (16 values). Classic admin has three different hardcoded copies, none matching it and none matching each other:

| Location | List | vs. canonical |
|---|---|---|
| `events/[eventId]/page.tsx:59`, `events/page.tsx:18`, `series/page.tsx:51` (identical, copy-pasted 3×) | `High Energy, Boujee, Divey, Rooftop, Speakeasy, Late Night, Hip-Hop, R&B, Live Music, Brunch, LGBTQ+` | Missing 8 canonical vibes (Chill, Dance, Date Night, Sports, Cultural, Hookah, Lounge, Adult); includes 3 values (`Hip-Hop`, `R&B`, `LGBTQ+`) that belong to the separate `Crowd` enum, not `Vibe` |
| `venues/page.tsx:171` (`MVIB`) | `High Energy, Boujee, Divey, Rooftop, Speakeasy, Sports Bar, Lounge, Late Night, Hip-Hop, R&B, EDM, Jazz, Live Music, Brunch, LGBTQ+, Karaoke` | A *different* 16-item list; ~9 values aren't in the canonical `Vibe` enum at all |

Selecting a non-canonical value writes it straight into the `vibes` array field that mobile-app queries use for `array-contains-any` vibe filtering — a value like `"R&B"` or `"EDM"` picked in admin will never match a consumer vibe filter, and half the real vibes (e.g. `Chill`, `Date Night`, `Adult`) can't be set on an event or series at all from admin. This is exactly the "vibes parity with app" question the original task asked to check, and it's broken in three places.

**Audit-log blind spot on live edit surfaces** — see the Audit Log section above; this is the single most consistent pattern across the whole audit (Events, Venues, Series all share it).

**A recurring dead-code shape:** both Events and Venues list pages retain a full "Edit" modal (`openEdit`/`modal==="edit"`) that the actual "Edit" button no longer opens (it `router.push`es to the detail page instead). The dead code isn't just clutter — in Events, it also carries a field-schema mismatch against the live detail page that would reintroduce a sold-ticket-count-wiping bug if ever reconnected (Events P1 above).

---

## Prioritized fix list

**P0 — would embarrass in a live investor demo:**
1. Fix `hasTickets` to clear when the last ticket tier is deleted (Events).
2. Write/update `dateISO` alongside `date` in both classic Events save paths (Events) — highest-impact single fix, affects every manually-created or dashboard-edited event's app-feed visibility.
3. Replace the three hardcoded `vibes` lists (Events ×2, Series, Venues) with the canonical `VIBES` enum from `firestore-v2.ts`, imported or mirrored consistently (cross-cutting).
4. Add a `vibes` editor to the Venues detail page's Info tab (currently the only way in is a dead-code modal) (Venues).
5. Wire `logAudit`/`logAuditServer` into the actual live edit paths: Events detail-page `setStatus`/`saveTicket`/`deleteTicket`, Venues detail-page `handleSave`, and all of Series' mutations (Events, Venues, Series, Audit Log).

**P1 — confusing but survivable:**
1. Reconcile or remove the dead `openEdit`/edit-modal ticket-tier schema in Events list page before it can be reconnected and wipe sold counts.
2. Remove or fix the same dead edit-modal pattern in Venues list page.
3. Extend event creation to use the same Media tab (staged assets/rights/upload) instead of a raw cover-image URL paste.
4. Surface `sourceAttribution` and `isSeriesAnchor` somewhere in classic Events admin.
5. Add an `isTestVenue` indicator (and ideally a toggle/filter) to Venues admin.
6. Reconcile the Venues category picker(s) against canonical `PRIMARY_CATEGORIES`, and/or surface `attributes`/`crowd`/`subcategories`.
7. Add basic moderation actions (unpublish gallery, remove photo) to Galleries admin.
8. Wire up the `promoterId` input in the Series modal, or remove the field.
9. Add an edit path for existing dashboard users' role/venueIds/eventIds/tableAccess.
10. Consider surfacing series media's "future occurrences only" caveat more prominently at save time, not just in a hint line.

**P2 — cosmetic / tech debt:**
1. Either implement `EventStatus.closed` somewhere or drop it from the type.
2. Align Events' `pending` filter/status label with canonical `pending_review` (low risk today, but confusing to a new reader of the code).
3. Add `closed`/`disabled` to the Venues list-page status filter buttons.
4. Cross-link Bronze-upload "Photos" tab to the resulting gallery.
5. Add click-through from Tickets' Event cell and Audit Log's Target cell to the underlying record.

## Not verified from this session

This was a static, read-only code audit — no access to the live `wugi-prod` Firestore data, so claims about *current document contents* (e.g., how many existing events actually lack `dateISO`, how many venues carry non-canonical vibe strings today) are inferred from the write paths, not measured directly. A quick `firebase firestore:export`-based spot check (or the existing `mobile-app/scripts/backfill-missing-fields.js --dry-run --list` pattern, extended to `dateISO` and `vibes`) would confirm blast radius before any fix is prioritized.

## Files changed in this PR

- `docs/audits/2026-09-admin-surface-audit.md` — this artifact (no other files touched; audit is read-only per scope amendment)

# Chargeback Pipeline + Payout/Reserve Engine — Audit & Verification

**Status:** Untracked infrastructure — no Asana coverage as of 2026-07-19 audit
(`docs/AUDIT-2026-07-19.md`, section C.1–C.2). This page documents what
actually ships in code, what a code-only verification pass could confirm,
and the gaps that remain open.

**Scope:** `functions/src/stripe/webhook.ts:499-683` (dispute lifecycle, venue
billing, Tier-5 demotion), `functions/src/stripe/schedulePayouts.ts`,
`functions/src/stripe/releaseReserves.ts`, `functions/src/stripe/stripeUtils.ts`
(`calculateReserve`). Design intent for this system is already written up in
`docs/financial-model.md` (Reserve Fund, Payout Tiers, Chargeback Policy
sections) and `docs/ticketing-schema.md` (`payouts`, `chargebacks` schemas) —
this page is about what the *code* actually does versus that intent, not a
restatement of the design.

**Method:** Read-only code inspection of `origin/main`, no Firestore/GCP
access from this session (see Verification pass below for what that means
in practice, and the commands a human should run to close the gap).

---

## System 1 — Payout / reserve engine

**Where a payout record is born:** `webhook.ts` → `handlePaymentSuccess()`
(the `payment_intent.succeeded` handler), lines ~290-321. Every successful
mobile-app order writes one `payouts/{payoutId}` doc alongside the `orders`
doc, computed as:

- `reserveAmount = subtotal × venue.reservePercent` (default 5%,
  `calculateReserve()` in `stripeUtils.ts:29-34`)
- `netAmount = subtotal - reserveAmount` (booking fee is never part of the
  venue payout — it stays with Wugi)
- `scheduledFor` — Tier 5 venues get the next 2am ET daily batch
  (`getNextDailyBatchTime()`); everyone else gets `eventEndsAt + payoutDelayHours`
  (168h/72h/48h/24h by tier)
- `reserveReleaseAt` — `eventEndsAt + reserveHoldHours` (default 60h, 48-72h
  range), set on both the `payouts` doc and denormalized onto `orders`
  (`payoutReserveAmount`, `payoutReleaseAt`)

**Two scheduled Cloud Functions drive money movement**, both `pubsub.schedule('every 60 minutes')`:

- **`schedulePayouts`** (`schedulePayouts.ts`) — queries `payouts` where
  `status == 'scheduled' && scheduledFor <= now`, executes a
  `stripe.transfers.create()` per payout to the venue's Connect account,
  marks `paid`/`failed`, and flips linked `orders.payoutStatus` to `'paid'`.
- **`releaseReserves`** (`releaseReserves.ts`) — queries `orders` where
  `payoutStatus == 'reserved' && payoutReleaseAt <= now && status == 'confirmed'`,
  groups by venue, and transfers the accumulated reserve as a second Stripe
  transfer, marking `orders.payoutStatus = 'released'` and updating the
  linked `payouts.reserveReleased`.

Both are exported from `functions/src/index.ts:13,21` — they exist as
deployable Cloud Functions, not dead code.

## System 2 — Chargeback (dispute) pipeline

Driven entirely by the Stripe webhook (`stripeWebhook` in `webhook.ts`),
which subscribes to three dispute event types:

- **`charge.dispute.created`** → `handleDisputeCreated()` (line 504):
  resolves the charge back to a Wugi `orders` doc via the payment intent ID,
  attaches scan evidence (`passes.scanStatus === 'scanned'`) as a boolean
  flag, creates a `chargebacks/{id}` doc with a 7-21 day evidence deadline
  (from Stripe or a 7-day default), flips the order to `status: 'disputed'`,
  and increments `venues.chargebackCount`.
- **`charge.dispute.updated`** → `handleDisputeUpdated()` (line 594): flips
  the chargeback doc to `status: 'submitted'`. This is the only thing this
  handler does.
- **`charge.dispute.closed`** → `handleDisputeClosed()` (line 610): computes
  `totalVenueOwes` ($15 fee on a win, disputed amount + $15 on a loss), reads
  `venues.reserveBalance`, and decides whether to debit the reserve
  (`venueBalanceDebited`) or bill the venue directly
  (`venueBilledDirectly` / `venues.chargebackBalance`). If the venue is
  Tier 5, it also computes `chargebackCount / totalOrders` and demotes the
  venue to Tier 3 (`payoutTier = 3`, pre-event payouts turned off,
  48h post-event delay) if the rate exceeds 0.5%.

`transfer.created` / `transfer.reversed` handlers update `payouts` status
in response to the Stripe transfers issued by the two scheduled jobs above
(lines 691-730), and bump a `config/admin.failedPayoutCount` badge on
failure — this is the only place that badge is written or read from in
`functions/`, so verify the dashboard actually surfaces it before relying on
it operationally.

---

## Verification pass

This session has no Firestore/GCP credentials (unlike the `wugi-eas`
iOS-build environment described in `CLAUDE.md`, this GitHub Actions runner
has no `FIREBASE_SERVICE_ACCOUNT_B64`/service account materialized), so
"do scheduled jobs actually run in prod" and "are reserves/payouts firing"
could not be answered by querying `wugi-prod` directly. What follows is
everything that *could* be verified from code, plus the exact commands a
human (or a future agent run with Firestore access) should run to close the
loop.

### What code inspection confirms

- Both scheduled functions and the webhook are exported from
  `functions/src/index.ts` and would be picked up by
  `firebase deploy --only functions` — nothing is orphaned at the export
  level.
- There is **no CI pipeline** for this repo (`.github/workflows/` only
  contains `claude.yml`) — deploys are manual, run via
  `npm run deploy` (`firebase deploy --only functions`) from a developer
  machine. Whether the version of `webhook.ts`/`schedulePayouts.ts`/
  `releaseReserves.ts` on `main` matches what's actually running in
  `wugi-prod` cannot be determined from the repo alone.
- `functions/package.json` confirms `deploy`/`logs` scripts exist
  (`firebase deploy --only functions`, `firebase functions:log`) — these
  are the commands to run for the live check (see below).

### A concrete gap this pass *did* surface: missing composite indexes

`schedulePayouts.ts:20-24` queries `payouts` with an equality filter
(`status == 'scheduled'`) plus a range filter on a different field
(`scheduledFor <= now`). `releaseReserves.ts:20-25` queries `orders` with
two equality filters (`payoutStatus`, `status`) plus a range filter
(`payoutReleaseAt <= now`). Both shapes require a Firestore composite
index. **Neither index is present in `firebase/firestore.indexes.json`** —
that file only has indexes for `passes`, `eventPins`, `tickets`, `photos`,
`eventGalleries`, `events`, and `venues`.

Two possibilities, both worth checking directly against `wugi-prod`:

1. The indexes were created ad hoc via the Firebase console (clicking the
   auto-generated link in a `FAILED_PRECONDITION` error/log line), and
   `firestore.indexes.json` was never regenerated to match. This is a
   drift risk — the next `firebase deploy --only firestore:indexes` run
   would not delete an index missing from the file unless deployed with
   `--force`, but nobody currently has a source-of-truth definition of
   these indexes, and a *fresh* environment (or DR restore) would be
   missing them entirely.
2. The indexes were never created, in which case both scheduled jobs have
   been throwing `FAILED_PRECONDITION: The query requires an index` every
   hour since they were deployed, and no payout or reserve release has
   ever executed automatically in prod.

**How to check (needs `wugi-prod` access):**

```bash
# Do the scheduled jobs actually run, and do they succeed?
firebase functions:log --only schedulePayouts   -n 100
firebase functions:log --only releaseReserves   -n 100

# Or via gcloud, filtered for the telltale index error:
gcloud logging read \
  'resource.type="cloud_function" AND resource.labels.function_name=~"schedulePayouts|releaseReserves"' \
  --project wugi-prod --limit 200 --format=json | grep -i "FAILED_PRECONDITION\|requires an index"

# Confirm (or create) the indexes directly:
firebase firestore:indexes --project wugi-prod
```

If the `requires an index` string shows up, add the two composite indexes
below to `firebase/firestore.indexes.json` and deploy:

```json
{ "collectionGroup": "payouts", "queryScope": "COLLECTION", "fields": [
  { "fieldPath": "status", "order": "ASCENDING" },
  { "fieldPath": "scheduledFor", "order": "ASCENDING" }
]},
{ "collectionGroup": "orders", "queryScope": "COLLECTION", "fields": [
  { "fieldPath": "payoutStatus", "order": "ASCENDING" },
  { "fieldPath": "status", "order": "ASCENDING" },
  { "fieldPath": "payoutReleaseAt", "order": "ASCENDING" }
]}
```

### Data check to confirm actual firing (needs Firestore read access)

```bash
# Any payouts stuck in 'scheduled' well past their scheduledFor time?
# (Firestore console or a small admin script)
db.collection('payouts')
  .where('status', '==', 'scheduled')
  .where('scheduledFor', '<=', new Date())
  .get()   # non-empty + old createdAt ⇒ the job isn't running

# Any orders stuck in payoutStatus 'reserved' past payoutReleaseAt?
db.collection('orders')
  .where('payoutStatus', '==', 'reserved')
  .where('payoutReleaseAt', '<=', new Date())
  .get()   # non-empty + old ⇒ releaseReserves isn't running

# Has any venue.reserveBalance ever been non-zero? (see gap below)
db.collectionGroup('venues').where('reserveBalance', '>', 0).get()
```

---

## Gaps

Ranked roughly by severity/likelihood of causing wrong money movement.

1. **`venues.reserveBalance` is never incremented anywhere in the codebase**
   (only read and decremented, `webhook.ts:635,658`). The documented design
   (`docs/financial-model.md` "Reserve Fund") is: hold 5% per order, and
   when a chargeback resolves, debit that reserve first before billing the
   venue directly. In code, the per-order reserve (`payout.reserveHeld` /
   `order.payoutReserveAmount`) is transferred **straight to the venue's
   Stripe Connect account** by `releaseReserves.ts` 48-72h after the event —
   it never accumulates in `venue.reserveBalance`. So `handleDisputeClosed`
   always sees `reserve = 0`, `venueBalanceDebited` is always `false`, and
   every chargeback falls through to `venueBilledDirectly` / accrues
   `chargebackBalance`. The reserve fund does not do what the docs say it
   does — the money it's supposed to draw from has already been paid out.
2. **Tier-5 demotion math is very likely mis-firing.** `venues.totalOrders`
   is read with a `?? 1` fallback (`webhook.ts:666`) and is **never
   incremented anywhere in `functions/`** (only present in a one-time
   migration script, `mobile-app/scripts/scrape/03-transform-and-write.js`).
   With `totalOrders` defaulting to 1, `chargebackRate = chargebackCount / 1`
   — a Tier-5 venue's **first-ever chargeback** computes as a 100% dispute
   rate against a 0.5% threshold, auto-demoting to Tier 3 and turning off
   pre-event payouts. The safety valve is almost certainly far more
   trigger-happy than the "Chargeback rate > 0.5%" design in
   `docs/financial-model.md:144` intends. Needs either a `totalOrders`
   incrementer (e.g. in `handlePaymentSuccess`) or a switch to counting
   actual per-venue order docs.
3. **Composite indexes for both scheduled jobs' queries are missing from
   `firebase/firestore.indexes.json`** (see Verification pass above) — if
   they were never created out-of-band in the console, neither scheduled
   job has ever completed successfully.
4. **Web checkout path likely never produces a `payouts` doc at all.**
   `functions/src/stripe/createCheckoutSession.ts:54` sets `metadata` on
   the Stripe **Checkout Session**, not via `payment_intent_data.metadata`
   on the underlying PaymentIntent. Stripe does not copy Session-level
   metadata onto the PaymentIntent automatically. `webhook.ts`'s
   `payment_intent.succeeded` handler (`handlePaymentSuccess`) reads
   `paymentIntent.metadata.userId/eventId/items` and bails with a logged
   error if any are missing (`webhook.ts:130-133`) — which they will be for
   every web-originated purchase, since the Checkout Session metadata never
   makes it to the PI. If true, `web/app/api/checkout/route.ts` purchases
   silently never create an `order`, `payouts`, or `passes` doc. This needs
   a runtime trace of one real web checkout to confirm, but it's consistent
   with `docs/AUDIT-2026-07-19.md` item C.10 flagging the web checkout path
   as parallel/untracked.
5. **No dashboard visibility into chargebacks or payouts.** The only
   `dashboard/` reference to this system is the raw
   `stripeConnectAccountId` field on the venue edit page
   (`dashboard/app/dashboard/venues/[venueId]/page.tsx:426`) — there is no
   chargeback list, no payout history/status view, and no surface for the
   `config/admin.failedPayoutCount` badge that `webhook.ts:726` and
   `schedulePayouts.ts:104` both increment on failure. Operationally, a
   failed payout or a lost dispute is invisible unless someone queries
   Firestore directly.
6. **No idempotency guard on `transfer.created`/`transfer.reversed`
   Stripe retries** beyond `payoutSnap.empty` — a duplicate webhook
   delivery would re-apply the same status update (harmless here since
   it's just a status flip) but there's no `event.id` dedup table
   anywhere in `webhook.ts`, unlike `handlePaymentSuccess`'s explicit
   `stripePaymentIntentId` existence check. Low risk given the operations
   are idempotent-by-construction, but worth noting as an inconsistency.
7. **`handleDisputeUpdated` is a no-op beyond a status flip** — evidence
   submission (`scan data automatically attached as evidence`, per
   `docs/financial-model.md:190-193`) is described in the design doc but
   there is no code in `webhook.ts` that actually calls Stripe's
   `disputes.update()` with evidence. The scan evidence boolean
   (`scanEvidenceAttached`) is stored on the `chargebacks` doc but never
   submitted back to Stripe — someone (or some other, unfound function)
   has to do that manually today. No `stripe.disputes.update` call exists
   anywhere in `functions/src/`.
8. **Money Transmitter License note in `docs/financial-model.md:1-8` is
   still an open legal item** ("must be resolved before the World Cup
   launch, June 9, 2026" — a date that has now passed relative to this
   audit's 2026-07-21 timestamp). Out of scope for this code audit but
   flagging since it directly gates the legality of this entire pipeline.

---

## Recommended next steps

- Run the `firebase functions:log` / `gcloud logging` commands above
  against `wugi-prod` to confirm whether `schedulePayouts` and
  `releaseReserves` have ever executed successfully.
- Add the two composite indexes and deploy, if the logs show
  `FAILED_PRECONDITION`.
- Decide whether `venue.reserveBalance` should be fed from
  `payout.reserveHeld` before release (design-as-documented) or whether
  `docs/financial-model.md`'s Reserve Fund section should be rewritten to
  match the as-shipped behavior (reserve pays the venue directly; there is
  no separate debit-first pool).
- Fix or remove the Tier-5 `totalOrders`-based chargeback-rate demotion
  before any Tier-5 venue takes its first chargeback.
- Trace one real `web/app/api/checkout` purchase end-to-end in prod logs
  to confirm whether it produces an `orders`/`payouts` doc at all.

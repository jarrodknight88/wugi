# Wugi Financial Model

## ⚠️ LEGAL NOTE — Money Transmitter License
Before going live with real transactions, consult a fintech attorney about a
**Money Transmitter License (MTL)**. Georgia requires one for platforms that
hold and disburse funds on behalf of third parties. Operating without one is a
regulatory violation. This must be resolved before the World Cup launch
(June 9, 2026).

Reference: Georgia Department of Banking and Finance
https://dbf.georgia.gov/

---

## Merchant of Record

**Wugi is the Merchant of Record on all transactions.**

Every ticket purchase shows "Wugi" on the buyer's credit card statement. Wugi
collects all funds, retains the booking fee, and pays out venue earnings via
Stripe Connect on the venue's payout schedule.

### Implications:
- Chargebacks come to Wugi first
- Wugi is responsible for tax collection and remittance
- Wugi must maintain PCI compliance via Stripe
- Venues are financially responsible for their chargebacks per Terms of Service

---

## Revenue Model

### Wugi revenue:
- **Booking fee** — charged to buyer on top of ticket price
- Venue keeps 100% of ticket face value (minus Stripe processing fees)
- "We take nothing from your ticket price" — key venue sales pitch

### Why this model:
- Venues love it — clear and simple
- Competitive differentiator vs. Eventbrite/Ticketmaster
- Post-World Cup: introduce optional venue-side percentage for premium features

---

## Booking Fee

| Parameter | Value |
|-----------|-------|
| Rate | 12% of order subtotal |
| Minimum | $1.99 |
| Maximum | $100.00 |

```
bookingFee = min($100, max($1.99, subtotal × 0.12))
```

All values stored in cents to avoid floating point math errors.
Adjustable per venue and per event from the admin dashboard.

---

## Tax

Tax is calculated automatically by **Stripe Tax**.

- Stripe Tax determines the correct rate based on buyer location, event type,
  and jurisdiction
- Rates are never hardcoded — Stripe handles changes automatically
- Stripe remits tax automatically — no manual filing required
- Tax product code for event tickets: `txcd_10000000`

### Tax-inclusive tickets:
Some ticket types (e.g. VIP tables priced at $1,200) may already include tax
in the price. These are flagged with `taxIncluded: true` on the ticket type.

**Workflow:**
1. Venue creates ticket type and checks "Tax included in price"
2. Ticket type saved as `approvalStatus: 'pending_approval'`
3. Admin dashboard flags it for review
4. Admin confirms → `approvalStatus: 'approved'`
5. Stripe Tax skips tax calculation for that ticket type

**Why admin confirmation:** Prevents accidental double-taxation and ensures
venues understand the implications of the flag.

### Checkout fee breakdown:
```
Subtotal                    $25.00
▼ Booking fee & taxes
   Booking fee (12%)         $3.00
   Georgia state tax (4%)    $1.00
   Atlanta city tax (4%)     $1.00
─────────────────────────────────
Total                       $30.00
```

For tax-inclusive tickets:
```
▼ Booking fee & taxes
   Booking fee (capped)    $100.00
   Tax                     Included in price
```

---

## Saved Payment Methods + Face ID

Implemented via **Stripe Payment Sheet**:
- Card data never touches Wugi servers — stored securely on Stripe
- Face ID / Touch ID confirmation built into the iOS payment sheet
- On first purchase: card saved to buyer's Stripe customer profile
- Return purchases: saved methods shown automatically
- `stripeCustomerId` stored on the Wugi user Firestore doc to link profiles

---

## Refund Policy

**Platform-wide no-refund policy.**

No exceptions at the platform level. Venues cannot override this.
Admin can issue refunds manually in exceptional circumstances (event cancellation,
venue emergency) via the admin dashboard — these are logged with reason codes.

---

## Payout Tiers

Venue payout timing is determined by their assigned tier.
Only admins can assign or change tiers.

| Tier | Name | Payout Timing | Pre-event | Notes |
|------|------|--------------|-----------|-------|
| 1 | Basic | 7 days post-event | ❌ | Default for new/unclaimed venues |
| 2 | Partner | 72 hours post-event | ❌ | Claimed and verified venues |
| 3 | Pro | 48 hours post-event | ❌ | Active venues in good standing |
| 4 | Elite | 24 hours post-event | ❌ | Top performing venues |
| 5 | Trusted | Daily batch | ✅ | Admin-assigned only. Highest trust |

### Tier 5 Trusted — special rules:
- Must be manually assigned by admin — no automatic promotion
- Pre-event payouts: money moves before the event happens
- Daily batch: funds swept at 2am ET each day
- Chargeback rate > 0.5% → automatic demotion to Tier 3
- Pre-event payouts pause on demotion pending review

### Payout fields on venue doc:
```typescript
{
  payoutTier: 1 | 2 | 3 | 4 | 5,
  payoutSchedule: 'post_event' | 'daily',
  payoutPreEvent: boolean,
  payoutDelayHours: 168 | 72 | 48 | 24 | 0,
  payoutTierAssignedBy: string,   // admin uid
  payoutTierAssignedAt: Timestamp
}
```

---

## Reserve Fund

A rolling reserve is held on every venue's gross ticket sales to cover
chargebacks before they hit Wugi's main Stripe balance.

| Parameter | Default | Overridable |
|-----------|---------|-------------|
| Reserve % | 5% | Per venue AND per event |
| Hold period | 48–72 hours post-event | Per venue AND per event |
| Default hold | 60 hours | — |

```
reserveAmount = subtotal × 0.05
reserveReleaseAt = eventEndsAt + reserveHoldHours
```

Reserve release is handled by a Cloud Function that runs on a schedule.

---

## Chargeback Policy

### How Stripe chargebacks work:
1. Buyer disputes a charge
2. Stripe **immediately withdraws the full transaction amount** from Wugi's account
3. Evidence window: 7–21 days to submit dispute evidence
4. Win → full amount returned, $15 dispute fee absorbed by venue
5. Lose → full amount lost, venue owes total + $15 fee

### Wugi's advantage in disputes:
Scan data from the Wugi app (timestamp, device, pass ID) serves as strong
evidence that the buyer attended the event. This is automatically attached to
every dispute submission.

### Venue responsibility by tier:

| Tier | Reserve | Auto-dispute | Communication |
|------|---------|-------------|---------------|
| 1 Basic | 5% | ✅ Wugi disputes | Email notification |
| 2 Partner | 5% | ✅ Wugi disputes | Email + dashboard alert |
| 3 Pro | 5% | ✅ Wugi disputes on behalf | Dashboard + evidence request |
| 4 Elite | 5% | ✅ Wugi disputes on behalf | Dedicated support |
| 5 Trusted | 5% | ✅ Wugi disputes proactively | Direct contact |

### Chargeback billing:
1. Reserve fund covers chargeback first
2. If reserve insufficient → Wugi covers, venue billed directly
3. Non-payment → account suspension
4. Tier 5 chargeback rate > 0.5% → automatic demotion to Tier 3

### Chargeback fee: $15 per dispute (win or lose)

---

## Stripe Processing Fees

Standard Stripe fees apply and are deducted before venue payout:
- Cards: 2.9% + $0.30 per transaction
- Apple Pay: same as cards
- International cards: additional 1.5%
- Stripe Tax: 0.5% per transaction
- Stripe Connect: 0.25% + $0.25 per payout

These are absorbed by the venue (deducted from their payout), not by Wugi.

---

## Platform-wide Fee Settings

All adjustable from admin dashboard (`config/ticketing` in Firestore):

```typescript
{
  bookingFeePercent: 0.12,
  bookingFeeMin: 199,          // cents
  bookingFeeMax: 10000,        // cents
  reservePercent: 0.05,
  reserveHoldHoursMin: 48,
  reserveHoldHoursMax: 72,
  reserveHoldHoursDefault: 60,
  chargebackFee: 1500,         // cents
  chargebackRateThresholdTier5: 0.005,
  stripeTaxEnabled: true,
  stripeTaxProductCode: 'txcd_10000000'
}
```

# Wugi Ticketing — Firestore Schema

## ⚠️ PRE-LAUNCH LEGAL NOTE
Before going live with real transactions, consult a fintech attorney about a
**Money Transmitter License (MTL)**. Georgia requires one for platforms that
hold and disburse funds on behalf of third parties. Operating without one is a
regulatory violation. Resolve before World Cup launch (June 9, 2026).

---

## Collections Overview

```
venues/{venueId}
  └── ticketTypes/{ticketTypeId}

events/{eventId}
  └── ticketTypes/{ticketTypeId}   ← event-specific overrides

orders/{orderId}
  └── items/{itemId}

passes/{passId}

payouts/{payoutId}

chargebacks/{chargebackId}

config/ticketing                    ← platform-wide fee settings
```

---

## venues/{venueId} — additions for ticketing

```typescript
{
  // === Stripe ===
  stripeConnectAccountId: string;       // "acct_xxx" — Stripe Connect account
  stripeConnectOnboarded: boolean;      // true once KYC + bank complete
  stripeConnectOnboardedAt: Timestamp;

  // === Payout tier ===
  // 1 Basic    → 7 days post-event
  // 2 Partner  → 72 hours post-event
  // 3 Pro      → 48 hours post-event
  // 4 Elite    → 24 hours post-event
  // 5 Trusted  → daily batch, pre-event allowed, admin-only assignment
  payoutTier: 1 | 2 | 3 | 4 | 5;
  payoutSchedule: 'post_event' | 'daily';
  payoutPreEvent: boolean;              // true only for Tier 5
  payoutDelayHours: 168 | 72 | 48 | 24 | 0;
  payoutTierAssignedBy: string;         // admin uid
  payoutTierAssignedAt: Timestamp;

  // === Reserve ===
  reservePercent: number;               // default 5, overridable per venue/event
  reserveHoldHours: number;             // default 60 (between 48–72), overridable
  reserveBalance: number;               // current held amount in cents

  // === Chargebacks ===
  chargebackRate: number;               // calculated: disputes / total orders
  chargebackBalance: number;            // amount owed to Wugi in cents
  chargebackCount: number;              // lifetime chargeback count
  chargebackSuspended: boolean;         // true if account suspended for non-payment
  chargebackSuspendedAt: Timestamp | null;
}
```

---

## ticketTypes/{ticketTypeId}
Subcollection under both `venues/{venueId}` and `events/{eventId}`.
Event-level ticket types override venue defaults for that specific event.

```typescript
{
  id: string;                           // auto-generated
  eventId: string;                      // parent event
  venueId: string;                      // parent venue
  name: string;                         // "General Admission", "VIP Table"
  description: string;                  // "Entry only · Limited availability"
  price: number;                        // in cents e.g. 2500 = $25.00
  isFree: boolean;                      // true → skip payment, still tracks RSVP

  // === Tax ===
  taxIncluded: boolean;                 // true → price already includes tax
                                        // false → Stripe Tax calculates on top
  taxIncludedSetBy: string;             // venue uid
  taxIncludedConfirmedBy: string | null; // admin uid — must confirm before live
  taxIncludedConfirmedAt: Timestamp | null;

  // === Availability ===
  capacity: number;                     // max tickets for this type
  sold: number;                         // running count (updated by webhook)
  remaining: number;                    // capacity - sold
  status: 'draft' | 'on_sale' | 'sold_out' | 'cancelled';

  // === Booking fee override ===
  // Leave null to use platform defaults (12%, min $1.99, max $100)
  bookingFeePercent: number | null;     // per-ticket-type override
  bookingFeeMin: number | null;         // in cents
  bookingFeeMax: number | null;         // in cents

  // === Visibility ===
  saleStartsAt: Timestamp | null;       // null = on sale immediately
  saleEndsAt: Timestamp | null;         // null = until sold out or event starts
  maxPerOrder: number;                  // default 10

  // === Admin ===
  // pending_approval → venue set taxIncluded, waiting admin confirm
  // approved → live and sellable
  // rejected → admin rejected, venue must edit
  approvalStatus: 'pending_approval' | 'approved' | 'rejected';
  approvalNote: string | null;          // admin note on rejection
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

## orders/{orderId}

```typescript
{
  id: string;                           // auto-generated
  userId: string;                       // buyer uid
  eventId: string;
  venueId: string;

  // === Line items ===
  items: {
    ticketTypeId: string;
    ticketTypeName: string;
    quantity: number;
    unitPrice: number;                  // in cents
    subtotal: number;                   // unitPrice × quantity, in cents
    taxIncluded: boolean;               // copied from ticketType at time of purchase
  }[];

  // === Financials (all in cents) ===
  subtotal: number;                     // sum of item subtotals
  bookingFee: number;                   // calculated: 12% of subtotal, min $1.99, max $100
  taxAmount: number;                    // from Stripe Tax (0 if all items taxIncluded)
  taxBreakdown: {                       // Stripe Tax jurisdiction breakdown
    jurisdiction: string;              // e.g. "Georgia", "City of Atlanta"
    taxType: string;                   // e.g. "state_sales_tax", "city_sales_tax"
    rate: number;                      // e.g. 0.04
    amount: number;                    // in cents
  }[];
  total: number;                        // subtotal + bookingFee + taxAmount

  // === Stripe ===
  stripePaymentIntentId: string;
  stripeCustomerId: string;             // buyer's Stripe customer ID
  paymentMethod: 'apple_pay' | 'card' | 'google_pay';
  paymentMethodLast4: string | null;    // for card payments

  // === Status ===
  // pending     → payment initiated
  // confirmed   → payment succeeded, passes generated
  // cancelled   → cancelled before event
  // refunded    → should not happen (no-refund policy) but exists for admin use
  // disputed    → chargeback filed
  status: 'pending' | 'confirmed' | 'cancelled' | 'refunded' | 'disputed';

  // === Payout tracking ===
  payoutStatus: 'pending' | 'reserved' | 'released' | 'paid';
  payoutReserveAmount: number;          // 5% of subtotal held in cents
  payoutReleaseAt: Timestamp;           // when reserve releases (48–72h post-event)
  payoutId: string | null;             // links to payouts/{payoutId} when paid

  // === Metadata ===
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

## passes/{passId}

One pass document per ticket in an order.
If an order has 2 × GA tickets, two pass documents are created.

```typescript
{
  id: string;                           // auto-generated — also the QR code value
  orderId: string;
  userId: string;                       // original buyer
  eventId: string;
  venueId: string;
  ticketTypeId: string;
  ticketTypeName: string;

  // === Pass details ===
  holderName: string;                   // buyer name (or transferee name)
  holderEmail: string;
  ticketNumber: string;                 // human readable e.g. "WG-2406-4921"

  // === Transfer ===
  transferredFrom: string | null;       // uid of original buyer if transferred
  transferredAt: Timestamp | null;
  isTransferred: boolean;

  // === Scan ===
  // valid       → not yet scanned
  // scanned     → scanned at door, entry confirmed
  // invalid     → failed validation (duplicate scan, wrong event, etc.)
  scanStatus: 'valid' | 'scanned' | 'invalid';
  scannedAt: Timestamp | null;
  scannedBy: string | null;             // uid of staff who scanned
  scannedByDevice: string | null;       // device identifier

  // === Apple Wallet ===
  appleWalletPassUrl: string | null;    // generated PassKit URL
  appleWalletAdded: boolean;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

## payouts/{payoutId}

```typescript
{
  id: string;
  venueId: string;
  stripeConnectAccountId: string;

  // === Orders included in this payout ===
  orderIds: string[];
  eventIds: string[];                   // events covered

  // === Financials (in cents) ===
  grossAmount: number;                  // total ticket sales
  bookingFeesCollected: number;         // stays with Wugi
  taxCollected: number;                 // remitted to Stripe Tax
  reserveHeld: number;                  // 5% held back
  netAmount: number;                    // what venue receives

  // === Payout tier at time of payout ===
  payoutTier: 1 | 2 | 3 | 4 | 5;
  payoutSchedule: 'post_event' | 'daily';
  isPreEvent: boolean;

  // === Stripe ===
  stripeTransferId: string | null;      // Stripe transfer ID when executed
  stripeTransferStatus: 'pending' | 'paid' | 'failed';

  // === Reserve release ===
  reserveReleaseAt: Timestamp;          // when the 5% reserve releases
  reserveReleased: boolean;
  reserveReleasedAt: Timestamp | null;
  reserveStripeTransferId: string | null;

  // === Status ===
  status: 'scheduled' | 'processing' | 'paid' | 'failed';
  failureReason: string | null;
  scheduledFor: Timestamp;             // when payout will execute
  paidAt: Timestamp | null;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

## chargebacks/{chargebackId}

```typescript
{
  id: string;
  venueId: string;
  orderId: string;
  passId: string | null;

  // === Stripe dispute ===
  stripeDisputeId: string;
  stripeChargeId: string;

  // === Financials (in cents) ===
  disputedAmount: number;               // full transaction amount clawed back
  disputeFee: number;                   // $15.00 = 1500 cents
  totalVenueOwes: number;               // disputedAmount + disputeFee if lost

  // === Evidence ===
  // Scan data from passes is automatically attached as evidence
  scanEvidenceAttached: boolean;
  evidenceSubmittedAt: Timestamp | null;
  evidenceDeadline: Timestamp;          // Stripe gives 7–21 days

  // === Outcome ===
  // open       → dispute filed, evidence window open
  // submitted  → evidence submitted, awaiting Stripe decision
  // won        → dispute won, funds returned (venue owes $15 fee only)
  // lost       → dispute lost, venue owes full amount + fee
  // accepted   → Wugi accepted the dispute (rare)
  status: 'open' | 'submitted' | 'won' | 'lost' | 'accepted';
  outcome: 'won' | 'lost' | 'pending' | null;
  resolvedAt: Timestamp | null;

  // === Venue billing ===
  venueBalanceDebited: boolean;         // true if deducted from reserve
  venueBilledDirectly: boolean;         // true if reserve insufficient
  venuePaid: boolean;
  venuePaidAt: Timestamp | null;
  suspensionTriggered: boolean;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

## config/ticketing

Platform-wide fee settings — adjustable from admin dashboard.

```typescript
{
  // === Booking fee ===
  bookingFeePercent: 0.12;             // 12%
  bookingFeeMin: 199;                  // $1.99 in cents
  bookingFeeMax: 10000;                // $100.00 in cents

  // === Reserve ===
  reservePercent: 0.05;                // 5% default
  reserveHoldHoursMin: 48;
  reserveHoldHoursMax: 72;
  reserveHoldHoursDefault: 60;

  // === Chargebacks ===
  chargebackFee: 1500;                 // $15.00 in cents
  chargebackRateThresholdTier5: 0.005; // 0.5% → demote Trusted tier

  // === Stripe Tax ===
  stripeTaxEnabled: true;
  stripeTaxProductCode: 'txcd_10000000'; // Stripe tax code for event tickets

  // === Payout tiers ===
  payoutTiers: {
    1: { name: 'Basic',   delayHours: 168, preEvent: false, schedule: 'post_event' },
    2: { name: 'Partner', delayHours: 72,  preEvent: false, schedule: 'post_event' },
    3: { name: 'Pro',     delayHours: 48,  preEvent: false, schedule: 'post_event' },
    4: { name: 'Elite',   delayHours: 24,  preEvent: false, schedule: 'post_event' },
    5: { name: 'Trusted', delayHours: 0,   preEvent: true,  schedule: 'daily'      },
  };

  updatedAt: Timestamp;
  updatedBy: string;                   // admin uid
}
```

---

## Firestore Security Rules additions

```javascript
// Ticket types — venue can create, admin must approve taxIncluded changes
match /events/{eventId}/ticketTypes/{ticketTypeId} {
  allow read: if true;
  allow create: if request.auth != null
    && request.auth.uid == resource.data.venueOwnerId;
  allow update: if
    // Venue can update non-tax fields
    (request.auth.uid == resource.data.venueOwnerId
      && !request.resource.data.diff(resource.data).affectedKeys()
          .hasAny(['taxIncludedConfirmedBy', 'approvalStatus']))
    // Admin can update anything
    || isAdmin(request.auth.uid);
}

// Orders — buyer can read their own, venue can read their event orders
match /orders/{orderId} {
  allow read: if request.auth.uid == resource.data.userId
    || isVenueOwner(request.auth.uid, resource.data.venueId)
    || isAdmin(request.auth.uid);
  allow create: if request.auth != null; // Stripe webhook creates via admin SDK
  allow update: if isAdmin(request.auth.uid); // only admin SDK updates orders
}

// Passes — holder can read their own, venue can read for scanning
match /passes/{passId} {
  allow read: if request.auth.uid == resource.data.userId
    || isVenueOwner(request.auth.uid, resource.data.venueId)
    || isAdmin(request.auth.uid);
  allow update: if
    // Venue staff can update scanStatus only
    (isVenueStaff(request.auth.uid, resource.data.venueId)
      && request.resource.data.diff(resource.data).affectedKeys()
          .hasOnly(['scanStatus', 'scannedAt', 'scannedBy', 'scannedByDevice', 'updatedAt']))
    || isAdmin(request.auth.uid);
}

// Payouts and chargebacks — admin only
match /payouts/{payoutId} {
  allow read: if isAdmin(request.auth.uid)
    || isVenueOwner(request.auth.uid, resource.data.venueId);
  allow write: if isAdmin(request.auth.uid);
}

match /chargebacks/{chargebackId} {
  allow read: if isAdmin(request.auth.uid)
    || isVenueOwner(request.auth.uid, resource.data.venueId);
  allow write: if isAdmin(request.auth.uid);
}
```

---

## Indexes required

```
orders:
  userId ASC, createdAt DESC
  venueId ASC, status ASC, createdAt DESC
  eventId ASC, status ASC, createdAt DESC
  payoutStatus ASC, payoutReleaseAt ASC

passes:
  userId ASC, createdAt DESC
  eventId ASC, scanStatus ASC
  orderId ASC

payouts:
  venueId ASC, status ASC, scheduledFor ASC
  status ASC, scheduledFor ASC

chargebacks:
  venueId ASC, status ASC, createdAt DESC
  status ASC, evidenceDeadline ASC
```

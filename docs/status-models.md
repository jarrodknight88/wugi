# Wugi Status Models

All statuses across the platform in one place. When in doubt about what a
status means or how transitions work, refer to this document.

---

## Venue Status

```
pending_review → unclaimed → approved
                           → closed
                           → disabled
```

| Status | Visible in app | Discovery | Claim CTA | Notes |
|--------|---------------|-----------|-----------|-------|
| `pending_review` | ✅ | ✅ | ✅ | Confidence < 80. Admin badge in dashboard |
| `unclaimed` | ✅ | ✅ | ✅ | Confidence ≥ 80. Auto-live from import |
| `approved` | ✅ | ✅ | ❌ | Venue has claimed and verified |
| `closed` | ✅ | ❌ | ❌ | Shows closure banner. Preserves history |
| `disabled` | ❌ | ❌ | ❌ | Hidden completely. Duplicates / bad data |

### Transition rules:
- Import script sets `pending_review` or `unclaimed` based on confidence score
- Admin approves `pending_review` → `unclaimed` or directly to `approved`
- Venue claims `unclaimed` → `approved` (after admin verification)
- Admin or script sets `closed` (never automatic)
- Admin sets `disabled` (never automatic)
- `closed` and `disabled` venues are skipped by the refresh script

---

## Ticket Type Status

```
draft → on_sale → sold_out
      → cancelled
```

| Status | Purchasable | Visible in app | Notes |
|--------|-------------|---------------|-------|
| `draft` | ❌ | ❌ | Being created by venue |
| `on_sale` | ✅ | ✅ | Active and purchasable |
| `sold_out` | ❌ | ✅ | Shows sold out badge |
| `cancelled` | ❌ | ❌ | Removed from sale |

### Ticket type approval status (separate from sale status):

| Status | Notes |
|--------|-------|
| `pending_approval` | Venue set `taxIncluded: true`. Admin must confirm |
| `approved` | Admin confirmed. Ticket type can go on sale |
| `rejected` | Admin rejected. Venue must edit and resubmit |

Both statuses must be correct before a ticket type is purchasable:
- `approvalStatus: 'approved'` AND `status: 'on_sale'`

---

## Order Status

```
pending → confirmed → disputed
                    → refunded (admin only, exceptional circumstances)
        → cancelled
```

| Status | Notes |
|--------|-------|
| `pending` | Payment initiated, awaiting Stripe confirmation |
| `confirmed` | Payment succeeded. Passes generated. |
| `cancelled` | Cancelled before event. No refund per platform policy |
| `refunded` | Admin-issued refund. Logged with reason code |
| `disputed` | Chargeback filed. Triggers chargeback workflow |

### Payout status (on order doc):

| Status | Notes |
|--------|-------|
| `pending` | Order confirmed, payout not yet scheduled |
| `reserved` | 5% reserve held, remainder scheduled for payout |
| `released` | Reserve released post-event hold period |
| `paid` | Full payout sent to venue via Stripe Connect |

---

## Pass Status

One pass document per individual ticket. A 2-ticket order creates 2 passes.

```
valid → scanned
      → invalid
```

| Status | Notes |
|--------|-------|
| `valid` | Not yet scanned. Ready for entry |
| `scanned` | Scanned at door. Entry confirmed. Timestamp recorded |
| `invalid` | Failed validation (duplicate scan, wrong event, cancelled order) |

### Scan validation rules:
- A `valid` pass → `scanned` on first scan
- A `scanned` pass scanned again → shows "Already scanned" warning (not `invalid`)
- A pass from a `disputed` or `refunded` order → `invalid`
- A pass from a different event → `invalid`

---

## Payout Status

```
scheduled → processing → paid
          → failed
```

| Status | Notes |
|--------|-------|
| `scheduled` | Payout queued. Will execute at scheduled time |
| `processing` | Stripe transfer initiated |
| `paid` | Transfer complete. Funds in venue's bank |
| `failed` | Transfer failed. Retry logic applies. Admin alerted |

---

## Chargeback Status

```
open → submitted → won
                 → lost
     → accepted
```

| Status | Notes |
|--------|-------|
| `open` | Dispute filed. Evidence window open (7–21 days) |
| `submitted` | Evidence submitted to Stripe. Awaiting decision |
| `won` | Dispute won. Funds returned. $15 fee billed to venue |
| `lost` | Dispute lost. Full amount + $15 fee billed to venue |
| `accepted` | Wugi accepted the dispute. Rare — admin decision only |

---

## User Role

| Role | Access |
|------|--------|
| `consumer` | Default. App access only |
| `venue_owner` | Can manage their venue, create events and ticket types, access scan mode |
| `promoter` | Can create events at venues. Scan mode access |
| `moderator` | Admin dashboard access. Cannot change platform settings |
| `super_admin` | Full access. Can assign payout tiers, adjust fees, issue refunds |

---

## Admin Dashboard Badge Counts

The admin dashboard shows badge counts for items needing attention:

| Badge | Source | Triggers |
|-------|--------|---------|
| Venues pending review | `config/admin.pendingVenueReviewCount` | Import script increments on each `pending_review` venue |
| Ticket types pending tax approval | Query `ticketTypes` where `approvalStatus == 'pending_approval'` | Venue sets `taxIncluded: true` |
| Open chargebacks | Query `chargebacks` where `status == 'open'` | Stripe webhook |
| Failed payouts | Query `payouts` where `status == 'failed'` | Stripe webhook |
| Suspended venues | Query `venues` where `chargebackSuspended == true` | Chargeback non-payment |

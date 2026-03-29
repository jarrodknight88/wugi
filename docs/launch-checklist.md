# Wugi Launch Checklist

**Hard launch:** June 9, 2026 — FIFA World Cup Atlanta opening match
**TestFlight deadline:** May 19, 2026

---

## ⚠️ Legal (do first — these take the longest)

- [ ] Consult fintech attorney re: **Money Transmitter License (MTL)**
      Georgia requires this for platforms that hold and disburse funds.
      Contact: Georgia Department of Banking and Finance (dbf.georgia.gov)
      **This must be resolved before going live with real transactions.**

- [ ] Have attorney review **Terms of Service** — must cover:
      - Platform-wide no-refund policy
      - Venue financial responsibility for chargebacks
      - Wugi as Merchant of Record
      - Data collection and privacy (CCPA, COPPA if applicable)
      - Venue liability for their events

- [ ] Have attorney review **Venue Partner Agreement** — must cover:
      - Payout tier assignment and changes
      - Chargeback responsibility and billing
      - Account suspension terms
      - Tax-inclusive ticket flag responsibility

---

## App Store (deadline: May 19, 2026)

- [ ] App icon — outsourced to designer
      Sizes needed: 1024×1024 (App Store), 60×60, 120×120, 180×180 (iOS)

- [ ] Splash screen — outsourced to designer

- [ ] Restore `com.wugimedia.wugi` App Store record
      (Bundle ID in use: `com.wugi.wugi` — confirm which to use)

- [ ] App Store screenshots — required for submission
      Sizes: 6.7" (iPhone 15 Pro Max), 6.5" (iPhone 14 Plus), 12.9" iPad

- [ ] App Store description, keywords, category

- [ ] Age rating questionnaire (nightlife app — likely 17+)

- [ ] Privacy policy URL (required for App Store)

- [ ] TestFlight build via EAS:
      ```bash
      eas build --platform ios --profile preview
      ```

- [ ] App Store submission via EAS:
      ```bash
      eas submit --platform ios
      ```

- [ ] Check App Store Connect Business tab:
      - Paid Apps Agreement signed
      - EU DSA compliance
      - Bank and tax info complete
      (These block TestFlight even when build is valid)

---

## Stripe (do this weekend)

- [x] Stripe account created at stripe.com (jarrod@wugi.us)
- [ ] Stripe Connect platform setup (for venue payouts)
- [ ] Apple Pay enabled and domain verified
- [ ] Stripe Tax enabled
      Set product code: `txcd_10000000` (event tickets)
- [ ] Stripe Radar configured (fraud rules)
- [ ] Stripe Webhook endpoint configured
      Events to listen for:
      - `payment_intent.succeeded`
      - `payment_intent.payment_failed`
      - `charge.dispute.created`
      - `charge.dispute.updated`
      - `charge.dispute.closed`
      - `transfer.created`
      - `transfer.failed`
      - `payout.paid`
- [ ] Live mode publishable key and secret key saved securely
- [ ] Webhook signing secret saved securely
- [ ] Test a full payment end-to-end in Stripe test mode

---

## Firebase / Backend

- [ ] Fix GitHub push — `serviceAccountKey.json` purged from history ✅ (done)
- [ ] Firestore security rules deployed to `wugi-prod`
- [ ] Firestore indexes created (see `ticketing-schema.md`)
- [ ] Cloud Functions deployed:
      - [ ] `onStripeWebhook`
      - [ ] `onPaymentSuccess`
      - [ ] `onDisputeCreated`
      - [ ] `onDisputeResolved`
      - [ ] `schedulePayouts`
      - [ ] `releaseReserves`
- [ ] `config/ticketing` document created in Firestore with initial values
- [ ] `config/admin` document created in Firestore
- [ ] Firebase Storage rules configured for venue photos and pass assets

---

## Mobile App Features

### Core (must have for launch)
- [x] Firebase Auth (sign up, sign in, sign out)
- [x] Firestore user profile creation
- [x] Home screen wired to Firestore with mock fallback
- [x] Discover screen wired to Firestore
- [ ] Stories fixes (Jarrod has notes)
- [ ] Vibe personalization end-to-end
- [ ] Venue profile screen
- [ ] Event profile screen
- [ ] Neighborhood filter in Discover tab
- [ ] "Claim this venue" CTA flow
- [ ] "Add your Instagram →" CTA on unclaimed venues
- [ ] Closed venue banner

### Ticketing (must have for launch)
- [ ] `TicketSelectionScreen` — ticket picker, qty, fee dropdown
- [ ] `PaymentScreen` — Stripe Payment Sheet + Apple Pay + Face ID
- [ ] `PassScreen` — QR code digital pass
- [ ] `ScanScreen` — venue scan mode (role-gated)
- [ ] Apple Wallet PassKit integration
- [ ] Ticket transfer flow

### Nice to have (post-launch)
- [ ] Push notifications
- [ ] Social sharing
- [ ] Wugi Lens integration
- [ ] Venue dashboard in-app

---

## Wugi Lens (separate app, deadline: May 19, 2026)

- [ ] GL.iNet Slate AX router + 256GB MicroSD + power bank kit (~$160)
- [ ] Python/Node.js bridge script
- [ ] Native app — full-res storage, 2MP proxy push, approval flow
- [ ] Firebase Storage integration
- [ ] App Store submission

---

## Data

- [x] 208 Atlanta venues seeded with real Google Places data
- [x] Hours, parking, photos, addresses refreshed
- [x] Instagram handles for 177/208 venues via SerpAPI
- [x] Confidence scores calculated
- [ ] Run `patchSeededVenues.js` to verify all 17 manual venues have `googlePlaceId`
- [ ] Close remaining flagged venues:
      - [x] `opera-atlanta` (→ Domaine ATL)
      - [ ] `elleven45-lounge`
      - [ ] `gold-room-atl`
      - [ ] `darwin-cocktails`
      - [ ] `ivy-buckhead`
- [ ] Continue neighborhood imports:
      - [x] Midtown
      - [x] Buckhead (partial)
      - [ ] Old Fourth Ward
      - [ ] East Atlanta Village
      - [ ] Westside
      - [ ] Downtown
      - [ ] Inman Park
      - [ ] Virginia Highland
      - [ ] Little Five Points
- [ ] Seed real events for World Cup weekend

---

## Business Development

- [ ] Venue outreach — app ready to show when:
      - Venue profile screen complete
      - Real data showing for their venue
      - Claim flow functional
- [ ] Prince Williams (ATLpics.net) — formalize equity agreement (5%)
- [ ] Teranga City — first official venue partner
- [ ] Fundraising outreach:
      - [ ] Atlanta Technology Angels
      - [ ] Collab Capital
      - [ ] Republic crowdfunding

---

## Photography

- [ ] Wugi Lens V1 kit assembled (hardware ~$160)
- [ ] Photography marketplace pricing finalized
      - Per-album hosting fees (tiered by storage)
      - Photographer subscriptions (Starter / Pro / Agency)
      - Wugi Lens access: Pro and Agency tiers only
- [ ] Prince Williams — first real photography set uploaded

---

## Pre-Launch Checklist (1 week before June 9)

- [ ] All Firestore indexes built and active
- [ ] Stripe live mode tested end-to-end with real card
- [ ] Apple Wallet pass tested on real device
- [ ] Scan mode tested at Teranga City
- [ ] Crash-free rate > 99% in TestFlight
- [ ] Analytics / logging configured
- [ ] Error monitoring (Sentry or Firebase Crashlytics) configured
- [ ] MTL legal situation resolved or attorney sign-off obtained
- [ ] No-refund policy visible in app before checkout
- [ ] App Store approved and live (allow 1–2 week review buffer)

---

## Post-Launch (World Cup window June 9 – July 19, 2026)

- [ ] Daily monitoring of chargeback rate
- [ ] Venue partner onboarding (claim flow)
- [ ] Photography content push for World Cup events
- [ ] Seed round fundraising conversations
- [ ] Wugi Lens V1 deployed with Prince Williams at World Cup events
- [ ] Collect user feedback for V2 prioritization

# Wugi - Codex Review Context

You are Codex, invoked from Claude Code for code review on the Wugi monorepo.
Wugi is a vibe-first Atlanta nightlife discovery and ticketing platform.
Hard launch: June 9, 2026 (FIFA World Cup Atlanta).

For full project conventions, see CLAUDE.md.
This file lists Wugi-specific foot-guns to actively flag during reviews.

## Stack

- Mobile: React Native / Expo SDK 54 / TypeScript / expo-router (`mobile-app/`)
- Door (venue check-in + Stripe Terminal Tap-to-Pay): `check-in-app/`
- Lens (event photography): `lens/`
- Web (marketing, wugi.us): Next.js (`web/`)
- Dashboard (dashboard.wugi.us): Next.js 16 / Tailwind (`dashboard/`)
- Backend: Firebase project `wugi-prod` (Firestore, Auth, Cloud Functions, Storage)
- Payments: Stripe (Payment Sheet, Terminal Tap-to-Pay, Connect, EmbeddedCheckout)

## Firestore foot-guns (highest priority)

Both equality filters (`where(field, '==', value)`) and `orderBy(field)` 
silently exclude docs where the field is missing — Firestore does not treat 
missing fields as null/false. This has caused multiple launch-blocking bugs.

**Audit ALL `where()` and `orderBy()` clauses on `events`, `venues`, and 
`deals` collections.** Specifically watch these fields:

- `isFeatured` — boolean, used for sorting featured-first. Must be present 
  on every doc. Default: `false`. Backfilled via `scripts/backfill-missing-fields.js`.
- `isSeriesAnchor` — boolean, used as equality filter to dedupe series. Must 
  be present on every doc. Default for new singletons: `true`. Series-stamping 
  pass in `scripts/scrape/03-transform-and-write.js` overwrites for siblings.
- `createdAt` — timestamp, used for `orderBy('createdAt', 'desc')` in ALL 
  feed queries. Currently exposed on legacy docs that may lack it. Cannot 
  be backfilled with synthetic values (would corrupt sort order). Flag any 
  new write path that omits `createdAt`.
- `vibes` — array, used in `array-contains-any` queries. Empty array is 
  WORSE than missing (still excludes from query, but harder to detect). 
  Flag any code path that writes `vibes: []` or `vibes` as undefined.
- `status` — string. Universal. Safe.
- `venueId`, `neighborhoodSlug` — intentional filters. Safe.

**New filters require either (a) confirmation the field is universally 
written across all writers, or (b) a backfill + writer-update plan.**

## Other Firestore patterns

- **Recursive rule evaluation.** Flag Firestore rules that call 
  `get(/databases/$(database)/documents/users/$(uid))` from inside a function 
  evaluated for a `users` collection read. The `users` read rule must be 
  `allow read: if isAuth()`, never `isStaff()` which re-fetches the same doc.

- **Batch write limits.** Firestore caps batched writes at 500 operations. 
  Backfill or bulk-write scripts must batch in chunks of ≤500.

- **Backfill scripts must be idempotent and target `wugi-prod` explicitly.** 
  Re-running must be safe. Never overwrite existing values when intent is 
  "set default if missing." Use `data().fieldName === undefined` checks, 
  not falsy checks (false is a valid value).

## iOS / Expo build-breakers

- **Native module imports must be top-level static imports**, never dynamic. 
  Applies to: Face ID/biometrics, Stripe Terminal, OneSignal, any native 
  bridge. Dynamic imports of native modules cause runtime crashes on iOS.

- **`app.json` entitlement changes require provisioning profile regeneration.** 
  Flag any `app.json` edit that modifies `associatedDomains`, payment 
  acceptance entitlements, or other entitlement-bearing keys without a note 
  that the EAS provisioning profile needs to be deleted and regenerated via 
  `npx eas-cli credentials`. Stale profiles cause TestFlight build failures.

- **Bundle IDs always come from `app.json` / `app.config.js`, never `eas.json`.** 
  Flag any `eas.json` edit that introduces a bundle identifier.

- **Xcode 26 beta compatibility.** The `fmt` pod must be pinned to `10.2.1` 
  via Podfile post-install hook. `FuseboxTracer.cpp` and `NetworkIOAgent.cpp` 
  also require `.contains()` → `.count()` patches on `folly::dynamic`.

- **Wugi Door cannot be built via EAS CLI.** Must be archived locally in 
  Xcode and distributed via App Store Connect manually due to the 
  `com.apple.developer.proximity-reader.payment.acceptance` entitlement.

## Stripe

- **Face ID / biometric calls must fire inside `intentConfiguration.confirmHandler`** 
  in Stripe Payment Sheet flows. Flag any biometric prompt code outside that 
  handler in payment paths — prompting before the sheet opens has caused bugs.

- **Webhook role-based pass creation:** purchaser vs guest distinction matters. 
  Flag webhook handler changes that don't preserve the `role` field on passes.

- **Tap-to-Pay still gated.** `TAP_TO_PAY_ENABLED` is `false` in production 
  pending Apple App Store distribution entitlement. Flag PRs that flip this 
  flag without confirming the entitlement is approved.

## Cloud Functions

- **Single-function deploys preferred.** Use 
  `firebase deploy --only functions:functionName --project wugi-prod`. Flag 
  changes that would force a full functions deploy unless explicitly intended.

- **Required secrets must be documented.** New function code that depends on 
  `RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, 
  `TWILIO_PHONE_NUMBER`, or any other Firebase Secret must include a comment 
  or README note stating which secret it depends on.

## Email / SMS

- **Resend SPF/DKIM DNS records still pending in GoDaddy.** Flag email-sending 
  code that assumes domain verification is complete for `wugi.us`.

- **Twilio A2P 10DLC pending Brand/Campaign approval.** Use Twilio Verify 
  for OTP/login flows (which bypass A2P requirements). Flag standard messaging 
  code that would require A2P-approved campaign.

## Review priorities

Prioritize findings in this order:

1. **Launch-blockers (P1):** Firestore query patterns that could silently 
   drop user-visible data; auth/payment correctness; provisioning/entitlement 
   regressions that block TestFlight.
2. **Build-breakers (P2):** iOS native compilation; type errors that surface 
   at runtime; Cloud Functions deploy failures.
3. **Pre-launch hygiene (P3):** type cleanliness; redundant code; minor 
   inefficiencies. De-prioritize unless explicitly asked.

For changes touching `app.json`, payments, auth, Firestore rules, or feed 
queries: be adversarial. These have caused multi-build debugging cycles.

## What NOT to flag (noise reduction)

- Generic "consider adding tests" suggestions — assumed.
- Style/linting nits — pre-launch focus is correctness, not polish.
- The 48 pre-existing TypeScript errors on `main` — separate cleanup task. 
  Only flag new tsc errors introduced by the diff under review.

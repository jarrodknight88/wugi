# Secrets Sweep — 2026-09-02

Executed for Asana task [S3-06](https://app.asana.com/1/1208137481227174/project/1214022910398008/task/1214020547116555) / issue #266, from a sandboxed cloud session with no Firebase/Vercel CLI auth (see "Not verifiable from this session" below).

## Result: repo is clean — 2 findings fixed, no leaked secrets

### 1. Codebase scan — commit history

- `git log --all --full-history -- .env .env.local .env.production ".env.*.local"` → **no results**. No `.env` file of any name has ever been committed, on any branch.
- `git log -p --all` searched for `sk_live_`, `sk_test_`, `rk_live_`, `AC[a-f0-9]{32}` (Twilio SID), `re_[A-Za-z0-9_]{16,}` (Resend) → **no real matches**. The one hit (`prepare_react_native_project!` in a Podfile diff) is a false positive on the `re_` pattern, not a key.

### 2. Codebase scan — working tree

Same patterns plus `pk_live_`/`pk_test_` (Stripe publishable) and OneSignal App ID, scanned across the full tree (excluding `node_modules`):

- `docs/architecture.md:234-235` — `STRIPE_PUBLISHABLE_KEY=pk_live_xxx` / `STRIPE_SECRET_KEY=sk_live_xxx`. Placeholder documentation, not real values. No action needed.
- `functions/scripts/test-media-moderation.js:158` — matched `AC[a-f0-9]{32}` case-insensitively inside the string `safeSearchAnnotation`. False positive, not a key.
- **`mobile-app/App.tsx:49`** — hardcoded **live** Stripe publishable key (`pk_live_51TFpe...`). **Fixed** — see below.
- **`mobile-app/src/hooks/useNotifications.ts:16`** — hardcoded OneSignal App ID (`02095a4e-3918-4e7b-9335-3677e95afe3c`). **Fixed** — see below.

All server-side secret consumers (`functions/src/**`) already source secrets correctly via `process.env.*` inside `runWith({ secrets: [...] })` or `defineSecret(...)` — `stripeUtils.ts`, `emailService.ts`, `smsService.ts`, `terminalFunctions.ts`, `stripe/webhook.ts`, `bridge/*Webhook.ts`. No hardcoded secret-side keys found anywhere in `functions/`.

### 3. Fixes applied

Both `pk_live_...` and the OneSignal App ID are **non-secret, public client identifiers by design** (Stripe publishable keys and OneSignal App IDs ship inside every client bundle — the secret half is `STRIPE_SECRET_KEY` / `ONESIGNAL_REST_API_KEY`, both correctly server-side only). So this isn't a leak in the "drains your Stripe account" sense the issue is guarding against, but hardcoding them as scattered string literals is still bad practice: no single source of truth, harder to rotate, easy to accidentally leave a stale/wrong-environment value behind.

Fix: centralized both into `mobile-app/app.json` → `extra`, matching the repo's existing convention for public client config (`extra.googleWebClientId`, documented in root `CLAUDE.md`):

- `app.json` → `extra.stripePublishableKey`, `extra.oneSignalAppId` (new)
- `App.tsx` reads `Constants.expoConfig?.extra?.stripePublishableKey` instead of a literal
- `useNotifications.ts` reads `Constants.expoConfig?.extra?.oneSignalAppId` instead of a literal

This is JS-only — no native rebuild required (same as the `googleWebClientId` precedent).

### 4. `.gitignore` — env file coverage

Root `.gitignore` only ignored `.env`, `.env.local`, and `.env.*.local` — **`.env.production` (called out explicitly in the issue) was not covered**, nor was any other bare `.env.<name>` variant (e.g. `.env.development`, `.env.test`). `mobile-app/.gitignore` had the same gap (`.env*.local` only). `functions/`, `web/`, and `dashboard/` already had broad `.env*` patterns.

**Fixed**: root `.gitignore` now has `.env` + `.env.*`, which (being unanchored) applies at every directory depth in the tree — this closes the gap repo-wide, including `mobile-app/`, `check-in-app/`, and `lens/`, without needing to touch each package's own `.gitignore`.

No `.env*` file was ever tracked by git in any package (`git ls-files | grep -i '\.env'` → empty), so this is a hardening fix, not a response to an actual leak.

### 5. Vercel `NEXT_PUBLIC_` audit

Checked every `NEXT_PUBLIC_*` reference in `web/` and `dashboard/`:

| Variable | File | Verdict |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | `web/lib/firebase.ts`, `web/app/tickets/[orderId]/PassView.tsx`, `dashboard/lib/firebase.ts` | Safe — Firebase web API key is not a secret by design (restricted by Firebase Security Rules / API restrictions, not by key secrecy) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | `dashboard/app/dashboard/venues/[venueId]/page.tsx` | Safe — Maps JS key, meant for client use, should be HTTP-referrer restricted in Google Cloud Console (not verifiable from here) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `web/app/pay/[orderId]/BalancePayForm.tsx` | Safe — publishable key, same category as the mobile fix above |

No `NEXT_PUBLIC_` variable exposes a secret/server key. No changes needed here.

### 6. Not verifiable from this session

This session runs without the `wugi-eas` credentialed environment (no `FIREBASE_SERVICE_ACCOUNT_B64`, no Vercel token) and has no Firebase/Vercel CLI auth, so the following items from the task **could not be checked programmatically** and need a human (or an authenticated `wugi-eas` session) to confirm:

- Firebase Secret Manager values for `wugi-prod`: `STRIPE_SECRET_KEY` (live), `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_PHONE_NUMBER` (once integrated), `SUPER_ADMIN_PIN_RICH`.
  - Check: `firebase functions:secrets:access STRIPE_SECRET_KEY --project wugi-prod` (repeat per secret name; add `SUPER_ADMIN_PIN` too since `validateSuperAdminPin.ts` also reads it).
- Vercel env vars for `wugi.us` and `dashboard.wugi.us` are production values, not test/staging leftovers.
  - Check: `vercel env ls production` in each project directory.
- App Store Connect / TestFlight bundle: confirm no Firebase config ships beyond `GoogleService-Info.plist` (spot check via `unzip -l` on a downloaded `.ipa`, or `eas build:view <id>` artifact inspection) — out of scope for a static source scan.

## Files changed in this PR

- `mobile-app/App.tsx` — Stripe publishable key sourced from `app.json` extra instead of hardcoded
- `mobile-app/src/hooks/useNotifications.ts` — OneSignal App ID sourced from `app.json` extra instead of hardcoded
- `mobile-app/app.json` — added `extra.stripePublishableKey`, `extra.oneSignalAppId`
- `.gitignore` — broadened env-file coverage to catch `.env.production` and all other `.env.*` variants
- `docs/audits/2026-09-02-secrets-sweep.md` — this artifact

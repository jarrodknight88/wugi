# Wugi — Agent Operations Guide

Wugi is a vibe-first Atlanta nightlife discovery + ticketing platform.
Monorepo: `mobile-app/` (Expo consumer app), `dashboard/`, `web/`, `functions/`,
`firebase/`, `check-in-app/`, `lens/`. Backend is Firebase project `wugi-prod`.
Review foot-guns live in AGENTS.md.

## Credentials (cloud sessions)

The `wugi-eas` Claude environment holds secrets as env vars; the SessionStart
hook in `.claude/settings.json` materializes them to gitignored files:

- `EXPO_TOKEN` — EAS CLI auth (account: phatbat).
- `ASC_API_KEY_P8_BASE64` → `mobile-app/AuthKey_ASTT7364WJ.p8` — App Store
  Connect API key (App Manager). Paired with the `EXPO_ASC_*` env vars in
  `.claude/settings.json` for headless Apple auth. Team: D9438V88S5.
- `FIREBASE_SERVICE_ACCOUNT_B64` → `mobile-app/scripts/serviceAccount.json` —
  Firebase admin for `wugi-prod` (used by seed scripts and admin API calls).

## iOS builds (EAS, headless)

Run from `mobile-app/`. Profiles in `eas.json`: `development` (dev client,
internal), `preview` (internal), `testflight` / `production` (store).

- Dev client: `eas build --profile development --platform ios --non-interactive --no-wait`
- **TestFlight release (on-demand, the agreed workflow):**
  `eas build --profile testflight --platform ios --auto-submit --non-interactive --no-wait`
  then monitor with `eas build:view <id> --json`. Submission uses the
  `testflight` submit profile (ascAppId 6760943066, key above). Build number
  auto-increments.

### Hard-won gotchas

- EAS **cannot sync new capabilities with API-key auth** (cookie auth only).
  After adding an entitlement in app.json: enable the capability on the App ID
  yourself via the ASC API (see 2026-07-09 session: `bundleIdCapabilities`
  POST), then force profile regen with
  `eas build ... --refresh-ad-hoc-provisioning-profile`. Without this, builds
  fail at signing with "profile doesn't support capability".
- A 403 `REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED` from any ASC call means the
  Apple Program License Agreement needs re-acceptance by the Account Holder —
  nothing is wrong with the key.
- Store builds take 40–60 min (`buildReactNativeFromSource: true`).
- Wugi Door (`check-in-app/`) cannot be built on EAS at all (Tap-to-Pay
  entitlement) — local Xcode archive only.

## Social auth config

- Apple: native-only, no config needed beyond the App ID capability (enabled)
  and the Apple provider in Firebase console (enabled 2026-07-09).
- Google: web client ID lives in `mobile-app/app.json` →
  `extra.googleWebClientId`. iOS URL scheme is in the
  `@react-native-google-signin` plugin config. Both are set; changing them is
  JS-only (no rebuild).

## Git / release conventions

- Solo maintainer. PRs to `main`, squash-merged, no review gate — but run
  `npx tsc --noEmit` and compare error count to `main` first (~39 pre-existing
  errors; introduce zero new ones).
- Feature branches: `claude/wugi-*`.

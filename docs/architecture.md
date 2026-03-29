# Wugi Architecture

## Overview

Wugi is a premium Atlanta nightlife and dining discovery platform with
real-time photography, event listings, and integrated ticketing. The platform
consists of a consumer mobile app, an admin dashboard, a data pipeline, and
a set of Cloud Functions for backend logic.

---

## Monorepo Structure

```
wugi/
├── mobile-app/          ← React Native consumer app (primary focus)
├── dashboard/           ← Next.js admin dashboard
├── firebase/            ← Firebase configuration and security rules
├── functions/           ← Firebase Cloud Functions (backend logic)
├── docs/                ← Architecture, schema, and decision docs
└── scripts/             ← Data pipeline scripts (venue import, seeding)
    ├── importPlaces.js  ← Google Places import + refresh + Instagram
    ├── patchSeededVenues.js ← One-time patch for manually seeded venues
    ├── seedAtlanta.js   ← Manual venue seed data
    ├── serviceAccount.json  ← GITIGNORED — Firebase admin key
    └── .env             ← GITIGNORED — API keys
```

---

## Firebase Projects

| Project | ID | Usage |
|---------|-----|-------|
| Production | `wugi-prod` | Live app — all real data |
| Legacy | `wugi-be5da` | Original React/Firebase app — deprecated |

**Always use `wugi-prod`** for all development and production work.

---

## Mobile App

**Stack:**
- React Native + Expo SDK 54
- TypeScript
- `expo-router` (file-based routing)
- `@react-native-firebase` v23.8.8 (native SDK — NOT Firebase JS SDK)
- Firebase Auth + Firestore + Storage

**Key identifiers:**
- Bundle ID: `com.wugi.wugi`
- Apple Team ID: `D9438V8855`
- EAS account: `phatbat`
- App Store ID: `829564750`
- Apple ID: `rodk.music@gmail.com`

**Critical Firebase config:**
```json
// app.json plugins
["expo-build-properties", {
  "ios": {
    "useFrameworks": "static",
    "buildReactNativeFromSource": true
  }
}]
```
```ruby
# Podfile post_install (required)
installer.pods_project.targets.each do |target|
  target.build_configurations.each do |config|
    config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
  end
end
```

**Why native SDK (not Firebase JS SDK):**
Firebase JS SDK is incompatible with Expo SDK 54 / RN 0.81 / Hermes engine.
`@react-native-firebase` v23.8.8 is required. Must use modular API:
```typescript
// ✅ Correct
import { getAuth, signInWithEmailAndPassword } from '@react-native-firebase/auth'
import { getFirestore, collection, doc } from '@react-native-firebase/firestore'

// ❌ Wrong — causes silent failures
import auth from '@react-native-firebase/auth'
auth().signInWithEmailAndPassword(...)
```

**File structure:**
```
mobile-app/
├── App.tsx                     ← 3 lines, mounts RootNavigator
├── firebase.ts                 ← @react-native-firebase imports
├── firestoreService.ts         ← all Firestore queries (modular API)
└── src/
    ├── types/index.ts
    ├── constants/
    │   ├── colors.ts           ← theme tokens (dark + light)
    │   ├── mockData.ts         ← fallback data while Firestore populates
    │   └── ticketTypes.ts
    ├── components/
    │   ├── icons/index.tsx
    │   ├── SectionHeader.tsx
    │   ├── FeaturedCarousel.tsx
    │   └── TabBar.tsx
    ├── screens/                ← all 11 screens
    ├── features/
    │   ├── stories/            ← CameraScreen, StoriesBar, StoryViewer
    │   └── ticketing/          ← PassScreens, TicketSelection, Payment
    ├── context/
    │   └── FirebaseContext.tsx ← Auth state, signIn/signUp/signOut
    └── navigation/
        └── RootNavigator.tsx
```

**Design tokens:**
```typescript
// src/constants/colors.ts
accent: '#2a7a5a'   // primary green
bg:     '#0a0a0a'   // dark background
card:   '#141414'   // card surface
text:   '#f0f0f0'   // primary text
subtext: '#666'     // secondary text
```

Note: Figma file uses `#70a99e` (lighter teal). The actual app uses `#2a7a5a`
(darker green). Code is the source of truth.

---

## Admin Dashboard

**Stack:**
- Next.js 16
- TypeScript
- React
- TailwindCSS
- Firebase Auth + Firestore + Storage (same `wugi-prod` project)

**Features complete:**
- Firebase email/password login
- Role-based access (`super_admin` / `moderator` / `support`)
- Venue moderation queue (approve/reject)
- Events moderation queue
- Admin user management
- Real-time `onSnapshot` updates
- Audit logs
- Analytics dashboard (venue counts by status)
- Pending venue review badge (from `config/admin.pendingVenueReviewCount`)

**Known issue:**
Unauthorized screen shown if `users/{firebaseUID}` doc is missing.
Fix: ensure `upsertUserProfile` runs on every sign-in.

---

## Cloud Functions

Located in `functions/`. Written in TypeScript.

**Planned functions:**

| Function | Trigger | Purpose |
|----------|---------|---------|
| `onStripeWebhook` | HTTP | Handles all Stripe events (payment success, disputes, payouts) |
| `onPaymentSuccess` | Stripe event | Creates order + generates passes |
| `onDisputeCreated` | Stripe event | Creates chargeback doc, attaches scan evidence |
| `onDisputeResolved` | Stripe event | Updates chargeback status, bills venue |
| `schedulePayouts` | Scheduled (hourly) | Executes payouts based on tier timing |
| `releaseReserves` | Scheduled (hourly) | Releases 5% reserve 48–72h post-event |
| `chargebackSuspension` | Firestore trigger | Suspends venue on non-payment |
| `updateTicketInventory` | Firestore trigger | Updates `remaining` count on ticket type |

---

## Data Pipeline

**Scripts** run locally against the `wugi-prod` Firestore via Firebase Admin SDK.

**APIs used:**
- Google Places API (New) — venue discovery, structured data
- SerpAPI — Instagram handle lookup via Google search
- Firebase Admin SDK — direct Firestore writes

**Import workflow:**
1. `node importPlaces.js --neighborhood="Midtown"` — import new venues
2. `node importPlaces.js --instagram-only --test` — verify SerpAPI (5 venues)
3. `node importPlaces.js --instagram-only` — full Instagram lookup
4. `node importPlaces.js --refresh` — periodic refresh of existing venues
5. `node importPlaces.js --close --docId="x"` — close a venue

**Rate limits:**
- Google Places: $17 per 1,000 Text Search calls
- SerpAPI: 100 free searches/month, then paid tier

---

## Firestore Collections

```
users/{uid}                     ← user profiles, vibes, stripeCustomerId
venues/{venueId}                ← venue data, payout tier, reserve config
  └── ticketTypes/{id}          ← venue default ticket types
events/{eventId}                ← event data
  └── ticketTypes/{id}          ← event-specific ticket types
orders/{orderId}                ← purchase records
  └── items/{id}                ← line items
passes/{passId}                 ← individual ticket passes (QR codes)
payouts/{payoutId}              ← venue payout records
chargebacks/{chargebackId}      ← dispute tracking
config/
  ├── features                  ← feature flags (stories, etc.)
  ├── ticketing                 ← platform-wide fee settings
  └── admin                    ← badge counts for admin dashboard
```

---

## Stripe Integration

**Mode:** Wugi as Merchant of Record
**Connect type:** Standard Connect (venues have their own Stripe accounts)

**Key Stripe products used:**
- Stripe Payment Sheet — native iOS payment UI with saved cards + Face ID
- Stripe Connect — venue payouts
- Stripe Tax — automatic tax calculation and remittance
- Stripe Webhooks — order confirmation, dispute handling, payout events
- Stripe Radar — fraud detection

**Environment variables (never committed):**
```
STRIPE_PUBLISHABLE_KEY=pk_live_xxx
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_TAX_PRODUCT_CODE=txcd_10000000
```

---

## Figma

- File key: `RUMyPnpgCtKBwCDEPSeD1k`
- Key node IDs:
  - Home: `1401:1607`
  - Eateries/Menu: `1401:5785`
  - Venue Information: `3609:2031`
  - Event Profile: `5431:2304`

**Note:** Figma designs are aspirational references. The actual app implementation
is the source of truth for design decisions. Color tokens in Figma (`#70a99e`)
differ from the implemented tokens (`#2a7a5a`).

---

## Key Dates

| Date | Milestone |
|------|-----------|
| May 19, 2026 | TestFlight submission deadline |
| May 19, 2026 | Wugi Lens native app submission deadline |
| June 9, 2026 | Hard launch — FIFA World Cup Atlanta opening |

---

## Key Partners

| Partner | Role | Details |
|---------|------|---------|
| Prince Williams | Founding photographer | ATLpics.net, 162K Instagram, 5% equity |
| Teranga City | First venue partner | Jarrod works there — direct relationship |

---

## Development Environment

- macOS
- Node.js v20
- Xcode (for iOS builds)
- EAS CLI for TestFlight builds
- Firebase CLI for functions and rules deployment
- VS Code / Cursor

**First build after any `app.json` change:**
```bash
npx expo prebuild --platform ios --clean
# Re-add Podfile post_install hook
pod install
# Build in Xcode
```

Subsequent JS-only changes: just hit ⌘R in Xcode (Metro handles it).

# Wugi Door — Redesign Spec v1
*Author: PM session 2026-07-26. Source design: `Wugi_Design_System.zip` → `ui_kits/wugi-door/` (HANDOFF.md, DoorKit/DoorAuth/DoorMain/DoorSale/DoorColors).*
*Status: DRAFT — awaiting Jarrod review. Nothing dispatched from this yet.*

## 0. Decisions locked (Jarrod, 2026-07-26)

| # | Decision |
|---|---|
| 1 | Geofence: **client-soft for scans** (works offline, keeps the line moving), **hard server-side for money**. |
| 2 | Door ships for launch. TestFlight (`TAP_TO_PAY` unset) for UI iteration; `internal`/Xcode (`TAP_TO_PAY=true`) for Tap to Pay testing. Building without the entitlement does **not** revoke it — it is granted against the App ID, not baked per build. |
| 3 | Ticket colours are **in scope for Sept 1**. |
| 4 | `getPassStyle` and the design's ticket-colour system are the **same system**. Unify, do not duplicate. |
| 5 | Palette lives in Firestore `config/ticketPalette` + per-app fallback constant. (PM call.) |
| 6 | Semantic colours remap onto the 12-hue palette, **now**, while blast radius is zero. (PM call.) |
| 7 | Rotate-all: throttle the Wallet rebuild, do not restrict the action. (PM call.) |

## 1. Auth model — replaces anonymous + PIN

**Today:** `signInAnonymously()` (App.tsx:47) → PIN screen → `validateSuperAdminPin` → session. No `users/{uid}` doc exists, so every role predicate in the rules evaluates false.

**Target:** email/password accounts (design: `DoorSignIn`, with "Forgot password?") → **venue select** → **shift confirm**.

Consequences:
- Real `uid` → real `users/{uid}` doc → `isVenueStaff()` / `canAccessVenue()` finally work.
- **This is the fix for the PR #70 `/passes` blocker** — not custom claims. Retract that earlier recommendation.
- Staff accounts need provisioning from the dashboard: create user, set role, set `venueIds`.

### CRITICAL correction to PR #70
`isStaff()` in `firebase/firestore.rules:29` is `isSuperAdmin() || isModerator() || isSupport()` — **Wugi-internal staff, not venue door staff.** PR #70's `/passes` list rule therefore does NOT grant venue staff access, and would over-grant if it did (a Teranga door person must not list Prime's passes).

Correct rule:
```
allow list: if resource.data.userId == request.auth.uid
            || canAccessVenue(resource.data.venueId);
```
`canAccessVenue()` already exists (rules:32-36) and is venue-scoped via `venueIds()`. Use the existing primitive.

## 2. Geofence

**Today:** `generateDoorPin` writes `venueLatitude`/`venueLongitude` onto the PIN doc; `PINScreen:95` feeds them to `verifyAtVenue`. The PIN doc *is* the geofence carrier. Removing the PIN removes the geofence source.

**Target:** coordinates come from `venues/{venueId}.location` — populated on 446 venues as of 2026-07-26. Write the 4-key superset is already in place (`lat`/`lng`/`latitude`/`longitude`).

**Enforcement split (decision 1):**
- **Scan / check-in — client-side, fail-soft.** Check-in is currently a direct client Firestore write (`ManualLookupScreen`), and the design mandates offline scan queueing. Server-side enforcement is *impossible* for an offline scan. Client checks distance, warns, and records `scanLat`/`scanLng` + `geofenceOk` on the write. Out-of-area scans sync and are **flagged for review, not rejected** — never block the door.
- **Charge — server-side, hard.** `captureTerminalPayment` receives device coords and validates against `venues/{venueId}.location` before capturing. Reject out-of-area. This is the one that matters: it is money, and the device is online by definition.

## 3. Super-admin

"Exception not the rule" (Jarrod). Model as a role on the account, not a separate PIN flow:
- `users/{uid}.role === 'superadmin'` → sees all venues, bypasses venue scoping, bypasses geofence.
- This already happens implicitly: `validateSuperAdminPin` returns `venueLatitude: 0, venueLongitude: 0` (functions/src/door/validateSuperAdminPin.ts:48-49), a de-facto geofence bypass. We are making it explicit.
- Note `TerminalContext.tsx:68` short-circuits Terminal init when `venueId === '__super_admin__'` — this is why Tap to Pay showed "Reader not connected" in super-admin mode on 2026-07-26. In the new model super-admin picks a venue like anyone else, which removes the special case entirely.

## 4. Ticket colours — unify, do not rebuild

**The system already exists end to end.** The design re-specifies it.

```
dashboard sets events/{eventId}/tickets/{ticketId}.color
        ↓
onTicketColorChange  (functions/src/passes/ticketColorSync.ts — DEPLOYED)
        ↓
regenerateAndPush()  → rebuilds the Apple Wallet pass + APNs push
        ↓
consumer: getPassStyle(ticketTypeName, passColor)   (mobile-app/src/utils/safeData.ts:96)
door:     pass.passColor || '#2a7a5a'               (check-in-app ScannerScreen:105,116,161)
```

`getPassStyle` precedence today: `passColor` → semantic keyword → `hashColor()`.

### What the design actually adds
1. **Named 12-hue palette** (`TICKET_PALETTE`, `{id,name,hex}`) — staff match a *physical wristband*; colour is never shown without its name.
2. **Per-ticket override** — one ticket departs from its tier colour (comp upgrade, VIP bump at the door).
3. **Door-side controls** — today colour is dashboard-only.

### Unified resolution (extends the contract, does not break it)
```
passColorOverride   (per-ticket, set at the door)    ← NEW
  → passColor       (tier scheme)                     ← exists
    → semantic keyword → palette id                   ← REMAPPED
      → hash → palette id                             ← REMAPPED
```
`getPassStyle` remains the single resolution point. Behaviour is unchanged when no override is present. **The guardrail holds** — this is an extension.

### Required changes
- **Remap semantics onto the palette.** Today VIP→`#7c3aed`, table→`#1d4ed8`, backstage→`#111827`, early→`#2196F3`, free/rsvp→`#2a7a5a`, press→`#374151`, vvip→`#9f1239`. None are vendor-stockable. Remap each to a `TICKET_PALETTE` id. **`hashColor()` is the more important half** — it returns arbitrary hex for any unrecognised ticket type, which no staffer can match to a band. Constrain it to hash *into the palette*.
- **Store `colorId`, resolve to `{id,name,hex}`.** Hex alone loses the name the design requires.
- **`config/ticketPalette`** in Firestore is authoritative; each app carries a fallback constant so Door works offline.
- **Door write path** — Door needs to set tier scheme + per-ticket override. Prefer a callable over direct client writes so the geofence/role check is server-side.

### Two risks
- **Rotate-all = Wallet rebuild storm.** Every colour change re-issues the Apple Wallet pass and pushes APNs. Rotating all tiers mid-event could fan out to hundreds of rebuilds. Queue + debounce. Do NOT restrict the action — it is a fraud reset and is needed mid-event.
- **`.limit(5)` — VERIFY BEFORE BUILDING.** `ticketColorSync.ts` queries `orders where ticketId == X and eventId == Y` with `.limit(5)`. If `ticketId` identifies a ticket *type* rather than a single order line, only five passes ever regenerate and the rest silently keep the old colour. Confirm the semantics of `ticketId` before layering colour controls on top.

## 5. Cloud Functions delta

| Function | Change |
|---|---|
| `validateSuperAdminPin` | Retire — replaced by `users/{uid}.role` |
| `generateDoorPin` | Retire, or repurpose for staff provisioning |
| `createTerminalConnectionToken` | Unchanged |
| `createTerminalPaymentIntent` | Unchanged |
| `captureTerminalPayment` | **Add hard server-side geofence** |
| `cancelDoorSale` / `refundDoorSale` | Unchanged (staff-gated via PR #44) |
| `onTicketColorChange` | Add throttle/debounce; verify `.limit(5)` |
| **NEW** staff provisioning | Dashboard-side: create user, set role + `venueIds` |
| **NEW** set ticket colour | Callable; server-side role + venue check |
| **NEW** shift start/end | Only if shift records are wanted — design shows a shift-confirm screen |

## 6. Screens

| Design screen | Today | Note |
|---|---|---|
| SignIn | PINScreen | Replaces PIN |
| VenueSelect | SuperAdminEventSelector | Generalise to all staff |
| ShiftConfirm | — | New |
| Dashboard | DashboardScreen | Restyle + capacity gauge |
| Scanner / SuccessFlash / CheckinConfirm | ScannerScreen | Restyle + green flash + haptics/audio |
| Manual lookup | ManualLookupScreen | Restyle |
| Sale 1–4 | PaymentScreen | Restyle; Tap to Pay screen is **lead-up only** — never recreate Apple's system sheet |
| Settings | — | New |
| Ticket Colors + ColorPickerSheet | — | New |
| — | IDScanScreen | **NOT in the design.** Tied to `idVerificationThreshold`. Confirm it survives. |
| — | TransactionsScreen | **NOT in the design.** Confirm it survives. |

Design kit is **web JSX/HTML**, not React Native — every screen is a real port.

## 7. Dependencies (need explicit sign-off — violates "no new packages without discussion")
`expo-av` (scan cues, `playsInSilentModeIOS`) · `expo-haptics` · `expo-font` + 6 PP Neue Montreal OTFs.
Also: `check-in-app/node_modules` is **not installed** on the Air — install before any build or typecheck.

## 8. Open items
1. Verify `ticketId` semantics + the `.limit(5)` in `ticketColorSync.ts`.
2. Confirm IDScanScreen and TransactionsScreen survive the redesign.
3. Confirm Tap to Pay entitlement status for App ID `com.wugi.door` / Team `D9438V88S5` (Apple Case-ID `19309580`).
4. Resolve whether `httpsCallable` is safe in Release under `useFrameworks: static` — consumer app removed `@react-native-firebase/functions` entirely and moved to raw HTTPS. Door still has 13 `httpsCallable` sites. First TestFlight build answers this.
5. Staff provisioning UX — how does a venue get its door staff accounts created?

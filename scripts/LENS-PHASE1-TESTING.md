# Lens Phase 1 — Test Procedure (zero hardware)

End-to-end test of the hardware-capture ingest pipeline using
`scripts/lens-simulate-device.js` in place of the physical device.
Everything below runs locally against `wugi-prod`; the only prerequisites
are `serviceAccount.json` (in `scripts/` or `mobile-app/scripts/`) and a
one-time `npm install` at the repo root (for `sharp`).

## Architecture recap

```
device / simulator
      │  writes original JPEG
      ▼
Storage: lens-ingest/{deviceId}/{galleryId}/{filename}     (no public reads)
      │  ingestLensUpload (Cloud Function, storage trigger)
      │    · validates devices/{deviceId}: exists + active + assignment.galleryId matches
      │    · mismatch → Storage lens-quarantine/ + Firestore lensQuarantine log, STOP
      │    · sharp renditions → lens-renditions/{galleryId}/  (web 1600px q80, thumb 400px)
      │    · original preserved in lens-ingest/ (paid tier)
      ▼
Firestore: eventGalleries/{galleryId}/photos/{photoId}
      status 'pending', approved false, capturedAt (EXIF), deviceId
      + gallery pendingCount (device mode 'auto' skips straight to published)
      │  Lens app pending pool → Approve & Publish
      ▼
      status 'published', approved true  →  existing consumer surfaces
      (mobile useEventGallery, web /gallery/[galleryId])
      + wugi.us/claim/{deviceId}  (published, last 12 h, that device only)
```

## 0. One-time deploys (from the PR — needs explicit approval)

See the PR description for the exact commands (functions, storage rules,
firestore rules + indexes, web hosting).

## 1. Provision the prototype device

```bash
node scripts/lens-provision-device.js \
  --device lens-proto-01 \
  --event <tonights-eventId> \
  --photographer-email <your-lens-login-email>
```

This creates (idempotently):
- Auth user `lens-proto-01@devices.wugi.us` with custom claim
  `lensDeviceId: lens-proto-01` (password printed once — store it; the real
  hardware will sign in with it).
- `devices/lens-proto-01` — `mode: review`, `active: true`, assignment
  pointing at gallery `lens-lens-proto-01` (override with `--gallery`).
- The assigned `eventGalleries` doc, stamped with your photographer uid so
  the Lens app and Firestore rules line up.

`--photographer-email` must be the account you sign into the **Lens app**
with — the pending-pool query and the approve writes are rule-checked
against `photographerId`.

## 2. Simulate the device

```bash
node scripts/lens-simulate-device.js --device lens-proto-01 --count 8 --interval 2000
```

Each upload lands in `lens-ingest/` and the deployed function fans out.
Watch it live: `firebase functions:log --only ingestLensUpload --project wugi-prod`

Expected within a few seconds per photo:
- `lens-renditions/lens-lens-proto-01/<photoId>_web.jpg` + `_thumb.jpg` in Storage.
- `eventGalleries/lens-lens-proto-01/photos/*` docs with `status: 'pending'`,
  `approved: false`, `capturedAt` matching the EXIF stamp, `deviceId`.
- Gallery doc `pendingCount` == number uploaded.
- `devices/lens-proto-01` heartbeat: `heartbeatAt` fresh, `batteryPct` draining.

## 3. Pending pool → publish (Lens app)

1. Open Wugi Lens, sign in as the photographer, select tonight's event.
2. An amber "N photos waiting for review" banner appears on the Live Feed —
   tap **Review →**.
3. Select photos (tap tiles / Select All). **Approve & Publish** a few,
   **Reject** at least one.
4. Verify counters on the gallery doc: pendingCount down, publishedCount +
   photoCount up. Rejected photos keep `approved: false`, `status: 'rejected'`.

## 4. Consumer gallery + claim page

- Consumer app event screen (or `https://wugi.us/gallery/lens-lens-proto-01`):
  approved photos appear; pending/rejected never do.
- `https://wugi.us/claim/lens-proto-01`: published photos from the last
  12 hours in a mobile grid, with lightbox + save. (Until the new photos
  collection-group index finishes building, the page automatically falls
  back to the device's currently assigned gallery — same result for this
  test.)

## 5. Quarantine path

```bash
node scripts/lens-simulate-device.js --device lens-proto-01 --count 2 --mismatch
```

Expected: NOTHING new in the pending pool; objects moved to
`lens-quarantine/lens-proto-01/…`; two `lensQuarantine` docs with
`reason: 'gallery-mismatch (…)'`. Repeat after
`node scripts/lens-provision-device.js --device lens-proto-01 --inactive`
to check the `device-inactive` reason, then re-activate with `--active`.

## 6. Auto mode (optional)

```bash
node scripts/lens-provision-device.js --device lens-proto-01 --mode auto
node scripts/lens-simulate-device.js --device lens-proto-01 --count 3
```

Photos skip the pool: `status: 'published'`, `approved: true` immediately;
claim page + consumer gallery update with no review step.

## Storage-rules smoke test (device auth path)

The simulator uses the Admin SDK, which bypasses Storage rules. Before the
demo, verify the real device write path once the hardware arrives (or with
any Firebase client SDK): sign in as `lens-proto-01@devices.wugi.us` and
confirm (a) a write to `lens-ingest/lens-proto-01/<assigned-gallery>/x.jpg`
succeeds, (b) a write to `lens-ingest/other-device/...` is DENIED, and
(c) unauthenticated reads of `lens-ingest/...` are DENIED.

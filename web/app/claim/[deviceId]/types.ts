// ─────────────────────────────────────────────────────────────────────
// Wugi — /claim/[deviceId] types
// ─────────────────────────────────────────────────────────────────────

export type ClaimPhoto = {
  id:         string
  url:        string
  thumbUrl:   string
  capturedAt: string   // ISO
}

export type ClaimData = {
  deviceId:   string
  eventTitle: string
  venueName:  string
  galleryId:  string | null
  photos:     ClaimPhoto[]
  // Only meaningful when photos is empty — distinguishes "this device isn't
  // assigned to an event right now" from "assigned, but nothing published
  // yet" so the empty state can say something useful.
  emptyReason: 'no-assignment' | 'no-photos' | null
}

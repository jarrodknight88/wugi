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
  photos:     ClaimPhoto[]
}

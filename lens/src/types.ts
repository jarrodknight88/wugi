// ─────────────────────────────────────────────────────────────────────
// Wugi Lens — Types
// ─────────────────────────────────────────────────────────────────────

export type LensEvent = {
  id:        string
  title:     string
  venueName: string
  venueId:   string
  date:      string
  status:    'active' | 'upcoming' | 'closed'
  galleryId?: string
}

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error'

export type PhotoItem = {
  id:          string
  localUri:    string
  remoteUrl?:  string
  thumbUrl?:   string
  status:      UploadStatus
  progress:    number  // 0–100
  error?:      string
  uploadedAt?: Date
  width?:      number
  height?:     number
}

export type RouterStatus = 'disconnected' | 'connecting' | 'connected' | 'scanning'

export type LensSession = {
  event:       LensEvent
  galleryId:   string
  photos:      PhotoItem[]
  startedAt:   Date
  publishedCount: number
}

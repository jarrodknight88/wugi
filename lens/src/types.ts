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

// A photo doc sitting in the Lens Phase 1 pending pool
// (eventGalleries/{galleryId}/photos with status 'pending').
export type PendingPhoto = {
  id:         string
  url:        string
  thumbUrl:   string
  deviceId?:  string
  capturedAt: Date | null
}

export type LensSession = {
  event:       LensEvent
  galleryId:   string
  photos:      PhotoItem[]
  startedAt:   Date
  publishedCount: number
}

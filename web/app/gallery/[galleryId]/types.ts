export type GalleryPhoto = {
  id:         string
  url:        string
  thumbUrl:   string
  uploadedAt: string
}

export type GalleryData = {
  id:           string
  eventTitle:   string
  venueName:    string
  eventId:      string
  photoCount:   number
  status:       string
  createdAt:    string
  photos:       GalleryPhoto[]
}

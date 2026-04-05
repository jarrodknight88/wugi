// ─────────────────────────────────────────────────────────────────────
// Wugi Lens — useUploadQueue
// Manages concurrent photo uploads with retry logic
// ─────────────────────────────────────────────────────────────────────
import { useState, useCallback, useRef } from 'react'
import { uploadPhoto } from '../lib/firebase'
import type { PhotoItem, UploadStatus } from '../types'

const MAX_CONCURRENT = 3

export function useUploadQueue(galleryId: string | null) {
  const [photos,    setPhotos]    = useState<PhotoItem[]>([])
  const [uploading, setUploading] = useState(false)
  const activeCount = useRef(0)
  const queue       = useRef<PhotoItem[]>([])

  const updatePhoto = useCallback((id: string, update: Partial<PhotoItem>) => {
    setPhotos(prev => prev.map(p => p.id === id ? { ...p, ...update } : p))
  }, [])

  const processNext = useCallback(async () => {
    if (!galleryId || activeCount.current >= MAX_CONCURRENT) return
    const next = queue.current.find(p => p.status === 'queued')
    if (!next) { if (activeCount.current === 0) setUploading(false); return }

    activeCount.current++
    updatePhoto(next.id, { status: 'uploading', progress: 0 })

    try {
      const { url, thumbUrl } = await uploadPhoto(
        galleryId,
        next.localUri,
        next.id,
        pct => updatePhoto(next.id, { progress: pct })
      )
      updatePhoto(next.id, { status: 'done', progress: 100, remoteUrl: url, thumbUrl, uploadedAt: new Date() })
      // Remove from queue
      queue.current = queue.current.filter(p => p.id !== next.id)
    } catch (e: unknown) {
      updatePhoto(next.id, { status: 'error', error: e instanceof Error ? e.message : 'Upload failed' })
      queue.current = queue.current.filter(p => p.id !== next.id)
    } finally {
      activeCount.current--
      processNext()
    }
  }, [galleryId, updatePhoto])

  const enqueue = useCallback((localUris: string[]) => {
    const newItems: PhotoItem[] = localUris.map(uri => ({
      id:       Math.random().toString(36).slice(2),
      localUri: uri,
      status:   'queued' as UploadStatus,
      progress: 0,
    }))
    setPhotos(prev => [...newItems, ...prev])
    queue.current = [...newItems, ...queue.current]
    setUploading(true)
    // Kick off up to MAX_CONCURRENT uploads
    for (let i = 0; i < MAX_CONCURRENT; i++) processNext()
  }, [processNext])

  const retryFailed = useCallback(() => {
    setPhotos(prev => prev.map(p =>
      p.status === 'error' ? { ...p, status: 'queued', progress: 0, error: undefined } : p
    ))
    const failed = photos.filter(p => p.status === 'error').map(p => ({ ...p, status: 'queued' as UploadStatus, progress: 0 }))
    queue.current = [...failed, ...queue.current]
    if (failed.length > 0) { setUploading(true); processNext() }
  }, [photos, processNext])

  const publishedCount = photos.filter(p => p.status === 'done').length
  const queuedCount    = photos.filter(p => p.status === 'queued').length
  const errorCount     = photos.filter(p => p.status === 'error').length

  return { photos, uploading, enqueue, retryFailed, publishedCount, queuedCount, errorCount }
}

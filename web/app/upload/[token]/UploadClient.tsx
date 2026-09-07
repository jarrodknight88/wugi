'use client'
// ─────────────────────────────────────────────────────────────────────
// Wugi — UploadClient
// Drag-and-drop bulk photo upload — no login, token-gated. Uploads land
// one-file-per-request at /api/upload; a Storage-trigger Cloud Function
// (ingestWebUpload) does the actual processing (renditions, EXIF ordering)
// off this request path, so this component only needs to track per-file
// send progress, not processing status.
// ─────────────────────────────────────────────────────────────────────
import { useCallback, useRef, useState } from 'react'

const CONCURRENCY = 4
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif'

type ItemStatus = 'queued' | 'uploading' | 'done' | 'error'
type Item = { id: string; name: string; status: ItemStatus; error?: string }

function makeId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function UploadClient({
  token, eventTitle, venueName, galleryId,
}: {
  token: string
  eventTitle: string
  venueName: string
  galleryId: string
}) {
  const [items, setItems] = useState<Item[]>([])
  const [dragOver, setDragOver] = useState(false)
  const filesRef = useRef<Map<string, File>>(new Map())
  const queueRef = useRef<string[]>([])
  const inFlightRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const updateItem = useCallback((id: string, patch: Partial<Item>) => {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)))
  }, [])

  const uploadOne = useCallback(async (id: string) => {
    const file = filesRef.current.get(id)
    if (!file) return
    updateItem(id, { status: 'uploading' })
    try {
      const body = new FormData()
      body.set('token', token)
      body.set('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Upload failed (${res.status})`)
      }
      updateItem(id, { status: 'done' })
    } catch (e) {
      updateItem(id, { status: 'error', error: e instanceof Error ? e.message : 'Upload failed' })
    } finally {
      inFlightRef.current -= 1
      pump()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, updateItem])

  const pump = useCallback(() => {
    while (inFlightRef.current < CONCURRENCY && queueRef.current.length > 0) {
      const id = queueRef.current.shift()!
      inFlightRef.current += 1
      uploadOne(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const enqueue = useCallback((fileList: FileList | File[]) => {
    // Some mobile browsers omit `type` for camera-roll photos (esp. HEIC) —
    // let those through and have the server (which knows the real allowlist
    // via Content-Type sniffing) be the source of truth instead of silently
    // dropping a legitimate photo here.
    const files = Array.from(fileList).filter(f => !f.type || ACCEPT.split(',').includes(f.type))
    if (files.length === 0) return
    const newItems: Item[] = files.map(f => {
      const id = makeId()
      filesRef.current.set(id, f)
      return { id, name: f.name, status: 'queued' as const }
    })
    setItems(prev => [...prev, ...newItems])
    queueRef.current.push(...newItems.map(i => i.id))
    pump()
  }, [pump])

  const retry = useCallback((id: string) => {
    queueRef.current.push(id)
    updateItem(id, { status: 'queued', error: undefined })
    pump()
  }, [pump, updateItem])

  const doneCount  = items.filter(i => i.status === 'done').length
  const errorItems = items.filter(i => i.status === 'error')
  const busy       = items.some(i => i.status === 'queued' || i.status === 'uploading')

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0a', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ padding: '32px 24px 24px', maxWidth: 720, margin: '0 auto' }}>
        <a href="https://wugi.us" style={{ color: '#2a7a5a', fontSize: 22, fontWeight: 900, letterSpacing: -1, textDecoration: 'none' }}>wugi</a>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: '16px 0 4px', letterSpacing: -0.5 }}>Upload your photos</h1>
        <p style={{ color: '#888', fontSize: 15, margin: 0 }}>
          {eventTitle}{venueName ? ` · ${venueName}` : ''}
        </p>
        <p style={{ color: '#555', fontSize: 13, marginTop: 8 }}>
          Drop as many photos as you&apos;ve got — they&apos;ll be sorted into shot order automatically and published to
          the event gallery in the background. No account needed.
        </p>

        {/* Dropzone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault()
            setDragOver(false)
            if (e.dataTransfer.files) enqueue(e.dataTransfer.files)
          }}
          onClick={() => inputRef.current?.click()}
          style={{
            marginTop: 24, border: `2px dashed ${dragOver ? '#2a7a5a' : '#333'}`, borderRadius: 16,
            padding: '48px 24px', textAlign: 'center', cursor: 'pointer',
            backgroundColor: dragOver ? '#2a7a5a11' : 'transparent', transition: 'all 0.15s',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>📤</div>
          <p style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>
            {dragOver ? 'Drop to upload' : 'Drag photos here, or tap to browse'}
          </p>
          <p style={{ fontSize: 13, color: '#666', margin: 0 }}>JPEG, PNG, WEBP, or HEIC — up to 30MB each</p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            style={{ display: 'none' }}
            onChange={e => { if (e.target.files) enqueue(e.target.files); e.target.value = '' }}
          />
        </div>

        {/* Progress */}
        {items.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                {doneCount} / {items.length} uploaded
              </p>
              {!busy && doneCount > 0 && galleryId && (
                <a href={`/gallery/${galleryId}`} style={{ fontSize: 13, color: '#2a7a5a', fontWeight: 700, textDecoration: 'none' }}>
                  View gallery →
                </a>
              )}
            </div>

            <div style={{ height: 6, borderRadius: 3, backgroundColor: '#1a1a1a', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${items.length ? (doneCount / items.length) * 100 : 0}%`,
                backgroundColor: '#2a7a5a', transition: 'width 0.2s',
              }} />
            </div>

            {errorItems.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <p style={{ fontSize: 13, color: '#f87171', fontWeight: 600, margin: '0 0 8px' }}>
                  {errorItems.length} failed
                </p>
                {errorItems.map(it => (
                  <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderTop: '1px solid #1a1a1a' }}>
                    <span style={{ fontSize: 13, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
                      {it.name} — {it.error}
                    </span>
                    <button onClick={() => retry(it.id)} style={{ background: 'none', border: '1px solid #333', color: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                      Retry
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

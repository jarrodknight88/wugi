'use client'
// ─────────────────────────────────────────────────────────────────────
// Wugi — ClaimClient (Lens Phase 1)
// Mobile-first photo grid + lightbox for the /claim/[deviceId] page.
// Styling follows the existing GalleryClient dark theme.
// ─────────────────────────────────────────────────────────────────────
import { useCallback, useState } from 'react'
import type { ClaimData } from './types'

export default function ClaimClient({ claim, windowHours }: { claim: ClaimData; windowHours: number }) {
  const [lightbox, setLightbox] = useState<number | null>(null)

  const close = () => setLightbox(null)
  const prev = useCallback(() => setLightbox(i => i !== null ? Math.max(0, i - 1) : null), [])
  const next = useCallback(() => setLightbox(i => i !== null ? Math.min(claim.photos.length - 1, i + 1) : null), [claim.photos.length])

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0a', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* Header */}
      <div style={{ padding: '28px 16px 20px', borderBottom: '1px solid #1a1a1a', maxWidth: 1000, margin: '0 auto' }}>
        <a href="https://wugi.us" style={{ color: '#2a7a5a', fontSize: 22, fontWeight: 900, letterSpacing: -1, textDecoration: 'none' }}>wugi</a>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: '14px 0 4px', letterSpacing: -0.5 }}>Find your photos 📸</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#ccc', fontSize: 15, fontWeight: 600 }}>{claim.eventTitle}</span>
          {claim.venueName && <span style={{ color: '#888', fontSize: 14 }}>· {claim.venueName}</span>}
        </div>
        <p style={{ color: '#666', fontSize: 13, marginTop: 8 }}>
          Shot by Wugi Lens in the last {windowHours} hours. Tap a photo to view and save it.
        </p>
        <div style={{ marginTop: 14 }}>
          <a href="https://apps.apple.com/app/wugi/id829564750"
            style={{ backgroundColor: '#fff', color: '#000', fontSize: 13, fontWeight: 700, padding: '10px 18px', borderRadius: 10, textDecoration: 'none', display: 'inline-block' }}>
            📱 Get the Wugi App
          </a>
        </div>
      </div>

      {/* Photo grid — 2-up on phones, denser on wider screens */}
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: 12 }}>
        {claim.photos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 16px', color: '#555' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📷</div>
            <p style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>No photos yet</p>
            <p style={{ fontSize: 14, lineHeight: 1.5 }}>
              Photos from tonight will show up here as they&apos;re published. Check back in a few minutes.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
            {claim.photos.map((photo, i) => (
              <div
                key={photo.id}
                onClick={() => setLightbox(i)}
                style={{ cursor: 'pointer', borderRadius: 10, overflow: 'hidden', aspectRatio: '1', backgroundColor: '#161616' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.thumbUrl}
                  alt={`${claim.eventTitle} photo ${i + 1}`}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox !== null && claim.photos[lightbox] && (
        <div
          onClick={close}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.95)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
        >
          <button onClick={e => { e.stopPropagation(); prev() }}
            style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 28, width: 44, height: 44, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ‹
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={claim.photos[lightbox].url}
            alt=""
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '94vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 12 }}
          />
          <a
            href={claim.photos[lightbox].url}
            target="_blank"
            rel="noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ marginTop: 16, backgroundColor: '#2a7a5a', color: '#fff', fontSize: 14, fontWeight: 700, padding: '12px 24px', borderRadius: 10, textDecoration: 'none' }}
          >
            ⬇️ Save this photo
          </a>
          <button onClick={e => { e.stopPropagation(); next() }}
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 28, width: 44, height: 44, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ›
          </button>
          <button onClick={close}
            style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 18, width: 40, height: 40, borderRadius: '50%', cursor: 'pointer' }}>
            ✕
          </button>
          <div style={{ position: 'absolute', bottom: 16, color: '#888', fontSize: 13 }}>{lightbox + 1} / {claim.photos.length}</div>
        </div>
      )}
    </div>
  )
}

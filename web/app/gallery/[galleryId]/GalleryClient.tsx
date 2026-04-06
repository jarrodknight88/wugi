'use client'
// ─────────────────────────────────────────────────────────────────────
// Wugi — GalleryClient
// Masonry photo grid with lightbox — shareable event gallery
// ─────────────────────────────────────────────────────────────────────
import { useState, useCallback } from 'react'
import type { GalleryData, GalleryPhoto } from './types'

export default function GalleryClient({ gallery }: { gallery: GalleryData }) {
  const [lightbox, setLightbox] = useState<number | null>(null)

  const openLightbox  = (i: number) => setLightbox(i)
  const closeLightbox = () => setLightbox(null)
  const prev = useCallback(() => setLightbox(i => i !== null ? Math.max(0, i - 1) : null), [])
  const next = useCallback(() => setLightbox(i => i !== null ? Math.min(gallery.photos.length - 1, i + 1) : null), [gallery.photos.length])

  const date = gallery.createdAt
    ? new Date(gallery.createdAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : ''

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0a', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* Header */}
      <div style={{ padding: '32px 24px 24px', borderBottom: '1px solid #1a1a1a', maxWidth: 1200, margin: '0 auto' }}>
        <a href="https://wugi.us" style={{ color: '#2a7a5a', fontSize: 22, fontWeight: 900, letterSpacing: -1, textDecoration: 'none' }}>wugi</a>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: '16px 0 6px', letterSpacing: -0.5 }}>{gallery.eventTitle}</h1>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#888', fontSize: 15 }}>{gallery.venueName}</span>
          {date && <span style={{ color: '#555', fontSize: 14 }}>· {date}</span>}
          <span style={{ backgroundColor: '#2a7a5a22', color: '#2a7a5a', fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 20, border: '1px solid #2a7a5a44' }}>
            {gallery.photoCount} photos
          </span>
          {gallery.status === 'live' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#2a7a5a', fontSize: 12, fontWeight: 700 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#2a7a5a', display: 'inline-block' }}/>
              LIVE
            </span>
          )}
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
          <a href={`https://apps.apple.com/app/wugi/id829564750`}
            style={{ backgroundColor: '#fff', color: '#000', fontSize: 13, fontWeight: 700, padding: '10px 20px', borderRadius: 10, textDecoration: 'none', display: 'inline-block' }}>
            📱 Get the Wugi App
          </a>
          <button
            onClick={() => navigator.share?.({ title: gallery.eventTitle, url: window.location.href }) || navigator.clipboard?.writeText(window.location.href)}
            style={{ backgroundColor: '#1a1a1a', color: '#fff', fontSize: 13, fontWeight: 600, padding: '10px 20px', borderRadius: 10, border: '1px solid #2a2a2a', cursor: 'pointer' }}>
            Share Gallery
          </button>
        </div>
      </div>

      {/* Masonry grid */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
        {gallery.photos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#555' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📷</div>
            <p style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Photos coming soon</p>
            <p>The photographer is still uploading. Check back shortly.</p>
          </div>
        ) : (
          <div style={{ columns: 'auto 280px', columnGap: 8 }}>
            {gallery.photos.map((photo, i) => (
              <div
                key={photo.id}
                onClick={() => openLightbox(i)}
                style={{ breakInside: 'avoid', marginBottom: 8, cursor: 'pointer', borderRadius: 10, overflow: 'hidden', position: 'relative' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={`${gallery.eventTitle} photo ${i + 1}`}
                  loading="lazy"
                  style={{ width: '100%', display: 'block', borderRadius: 10, transition: 'opacity 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox !== null && (
        <div
          onClick={closeLightbox}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.95)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <button onClick={e => { e.stopPropagation(); prev() }}
            style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 28, width: 50, height: 50, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ‹
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={gallery.photos[lightbox].url}
            alt=""
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 12 }}
          />
          <button onClick={e => { e.stopPropagation(); next() }}
            style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 28, width: 50, height: 50, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ›
          </button>
          <button onClick={closeLightbox}
            style={{ position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 20, width: 44, height: 44, borderRadius: '50%', cursor: 'pointer' }}>
            ✕
          </button>
          <div style={{ position: 'absolute', bottom: 20, color: '#888', fontSize: 13 }}>{lightbox + 1} / {gallery.photos.length}</div>
        </div>
      )}
    </div>
  )
}

"use client"

import { useState, useEffect } from "react"
import { initializeApp, getApps } from "firebase/app"
import { getFirestore, doc, onSnapshot } from "firebase/firestore"
import QRCode from "qrcode"
import Link from "next/link"

const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

function getDb() {
  if (!getApps().length) initializeApp(firebaseConfig)
  return getFirestore()
}

function hexToRgb(hex: string) {
  const h = (hex || "#2a7a5a").replace("#", "")
  return {
    r: parseInt(h.slice(0,2), 16),
    g: parseInt(h.slice(2,4), 16),
    b: parseInt(h.slice(4,6), 16),
  }
}

interface PassData {
  passId: string; orderId: string; eventTitle: string; venueName: string
  eventDate: string; eventTime: string; ticketTypeName: string; holderName: string
  passColor: string | null; colorLabel: string | null; balanceDue: number
  depositPaid: number; passUrl: string | null; status: string
  source: string | null; transferredFromName: string | null
}

export default function PassView({ pass: initial }: { pass: PassData }) {
  const [pass,      setPass]      = useState(initial)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [pulse,     setPulse]     = useState(false)

  // Live Firestore listener — color, balance, status update in real time
  useEffect(() => {
    const db  = getDb()
    const ref = doc(db, "passes", initial.passId)
    const unsub = onSnapshot(ref, snap => {
      if (!snap.exists()) return
      const d = snap.data()
      setPass(prev => ({
        ...prev,
        passColor:  d.passColor  || prev.passColor,
        colorLabel: d.colorLabel || prev.colorLabel,
        balanceDue: d.balanceDue ?? prev.balanceDue,
        status:     d.scanStatus || prev.status,
        passUrl:    d.appleWalletPassUrl || d.passUrl || prev.passUrl,
      }))
    }, () => {})
    return unsub
  }, [initial.passId])

  // Generate QR
  useEffect(() => {
    QRCode.toDataURL(initial.passId, {
      width: 220, margin: 2,
      color: { dark: "#111111", light: "#ffffff" }
    }).then(url => setQrDataUrl(url)).catch(() => {})
  }, [initial.passId])

  // Pulse animation
  useEffect(() => {
    const id = setInterval(() => setPulse(p => !p), 900)
    return () => clearInterval(id)
  }, [])

  const color   = pass.passColor || "#2a7a5a"
  const { r, g, b } = hexToRgb(color)
  const walletUrl   = `https://wugi.us/api/wallet/${initial.passId}`
  const hasBalance  = (pass.balanceDue ?? 0) > 0
  const isScanned   = pass.status === "scanned"
  const isTransfer  = pass.source === "transfer"

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-8 relative overflow-hidden"
      style={{ backgroundColor: color }}>
      {/* Background glow */}
      <div className="absolute inset-0"
        style={{ background: `radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.15) 0%, transparent 60%)` }}/>
      <div className="absolute inset-0 bg-black/40"/>

      {/* Content */}
      <div className="relative z-10 w-full max-w-sm flex flex-col items-center gap-4">

        {/* Header */}
        <div className="w-full flex items-center justify-between">
          <Link href="/" className="text-white font-black text-2xl tracking-tight drop-shadow">wugi</Link>
          <span className="bg-black/30 text-white text-xs font-bold px-3 py-1.5 rounded-full tracking-widest border border-white/20">
            {(pass.colorLabel || pass.ticketTypeName || "TICKET").toUpperCase()}
          </span>
        </div>

        {/* Balance banner */}
        {hasBalance && (
          <div className="w-full bg-black/30 border border-yellow-400/60 rounded-xl px-4 py-3">
            <p className="text-yellow-400 text-sm font-bold text-center">
              ⚠️ ${((pass.balanceDue ?? 0) / 100).toFixed(2)} balance due at door
              {(pass.depositPaid ?? 0) > 0 ? ` · $${((pass.depositPaid ?? 0)/100).toFixed(2)} paid` : ""}
            </p>
          </div>
        )}

        {/* Scanned banner */}
        {isScanned && (
          <div className="w-full bg-black/30 border border-red-400/60 rounded-xl px-4 py-3">
            <p className="text-red-400 text-sm font-bold text-center">✓ This ticket has already been scanned</p>
          </div>
        )}

        {/* Event info */}
        <div className="w-full text-center">
          <h1 className="text-white font-black text-3xl leading-tight drop-shadow">{pass.eventTitle}</h1>
          <p className="text-white/80 text-base mt-1">{pass.venueName}</p>
          <p className="text-white/70 text-sm">{pass.eventDate}{pass.eventTime ? ` · ${pass.eventTime}` : ""}</p>
          {isTransfer && pass.transferredFromName && (
            <p className="text-white/50 text-xs mt-1">Transferred from {pass.transferredFromName}</p>
          )}
        </div>

        {/* QR code — pulsing */}
        <div className="flex flex-col items-center gap-3 my-2"
          style={{ transform: `scale(${pulse ? 1.03 : 0.98})`, transition: "transform 0.9s ease-in-out" }}>
          <div className="bg-white rounded-2xl p-4 shadow-2xl"
            style={{ boxShadow: `0 0 40px rgba(${r},${g},${b},0.6), 0 0 80px rgba(${r},${g},${b},0.3)` }}>
            {qrDataUrl
              ? <img src={qrDataUrl} alt="QR code" width={200} height={200} className="block"/>
              : <div className="w-[200px] h-[200px] bg-gray-100 rounded-xl flex items-center justify-center">
                  <span className="text-gray-400 text-sm">Loading…</span>
                </div>
            }
          </div>
          <p className="text-white/40 text-xs font-mono tracking-widest">
            {initial.passId.slice(-12).toUpperCase()}
          </p>
        </div>

        {/* Holder + assignment */}
        <div className="w-full flex items-center justify-between border-t border-white/20 pt-4">
          <div>
            <p className="text-white/50 text-xs font-bold tracking-widest uppercase">Holder</p>
            <p className="text-white font-bold text-base">{pass.holderName || "—"}</p>
          </div>
          {pass.colorLabel && (
            <div className="text-right">
              <p className="text-white/50 text-xs font-bold tracking-widest uppercase">Assignment</p>
              <p className="text-white font-bold text-base">{pass.colorLabel}</p>
            </div>
          )}
        </div>

        {/* Apple Wallet */}
        <a href={walletUrl}
          className="w-full flex items-center justify-center gap-2 bg-black/50 text-white font-bold py-4 rounded-2xl text-base border border-white/30 hover:bg-black/70 transition-colors">
          Add to Apple Wallet
        </a>

        {/* App download */}
        <div className="w-full bg-black/30 rounded-2xl p-4 text-center space-y-3 border border-white/10">
          <p className="text-white/60 text-xs">Manage all your passes in the Wugi app</p>
          <a href="https://apps.apple.com/app/wugi/id6760943066"
            className="block w-full bg-white/20 hover:bg-white/30 text-white font-bold py-3 rounded-xl text-sm transition-colors">
            Download Wugi
          </a>
          <button onClick={() => { window.location.href = `wugi://tickets/${initial.passId}` }}
            className="text-white/60 text-xs hover:text-white/90 transition-colors">
            Already have Wugi? Open in app →
          </button>
        </div>
      </div>
    </main>
  )
}

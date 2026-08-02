'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { db } from '@/lib/firebase'
import { doc, getDoc } from 'firebase/firestore'
import Link from 'next/link'
import TableColorManager from './TableColorManager'

export default function VenueTablesPage() {
  const params = useParams()
  const venueId = params.venueId as string
  const [venueName, setVenueName] = useState<string>('')
  const [loading, setLoading]    = useState(true)

  useEffect(() => {
    if (!venueId) return
    getDoc(doc(db, 'venues', venueId)).then(snap => {
      setVenueName(snap.exists() ? snap.data()?.name || 'Unknown Venue' : 'Unknown Venue')
      setLoading(false)
    })
  }, [venueId])

  if (loading) {
    return <div className="dash-page" style={{ color: "#9ca3af", fontSize: 14 }}>Loading…</div>
  }

  return (
    <div className="dash-page">
      <nav className="flex items-center gap-2 text-sm text-zinc-500 mb-6">
        <Link href="/dashboard" className="hover:text-zinc-700 dark:hover:text-zinc-300">Dashboard</Link>
        <span>/</span>
        <Link href="/dashboard/venues" className="hover:text-zinc-700 dark:hover:text-zinc-300">Venues</Link>
        <span>/</span>
        <span className="text-zinc-900 dark:text-white">{venueName}</span>
        <span>/</span>
        <span className="text-zinc-900 dark:text-white">Tables</span>
      </nav>
      <TableColorManager venueId={venueId} venueName={venueName} />
    </div>
  )
}

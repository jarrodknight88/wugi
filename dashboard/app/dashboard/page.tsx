"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { signOut } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { useAuth } from "@/hooks/useAuth"

export default function DashboardPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login")
    }
  }, [loading, router, user])

  async function handleLogout() {
    setIsLoggingOut(true)
    await signOut(auth)
    router.replace("/login")
  }

  if (loading) {
    return <main className="min-h-screen p-6">Checking authentication...</main>
  }

  if (!user) {
    return null
  }

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto flex max-w-3xl items-center justify-between">
        <h1 className="text-3xl font-bold">Wugi Admin Dashboard</h1>
        <button
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="rounded border border-neutral-300 px-4 py-2 text-sm"
        >
          {isLoggingOut ? "Logging out..." : "Logout"}
        </button>
      </div>
    </main>
  )
}

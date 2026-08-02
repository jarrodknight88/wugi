"use client"
import { useEffect, useState } from "react"

// matchMedia-backed breakpoint hook — no resize listener, no packages.
// Starts false (matches SSR) and flips after mount once the media query is
// evaluated client-side, same hydration-safe pattern as useAuthContext's
// initial-loading state.
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`)
    setIsMobile(mql.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  }, [breakpoint])

  return isMobile
}

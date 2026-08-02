"use client"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 12,
      background: "#f0f2f5", padding: 24, textAlign: "center",
    }}>
      <div style={{ fontSize: 40 }}>⚠️</div>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111827", margin: 0 }}>Something went wrong</h1>
      <p style={{ fontSize: 14, color: "#6b7280", margin: 0, maxWidth: 420 }}>
        An unexpected error occurred. You can try again, or come back in a moment.
      </p>
      {error.digest && (
        <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>Error digest: {error.digest}</p>
      )}
      <button onClick={() => reset()} style={{
        marginTop: 12, padding: "10px 24px", borderRadius: 8, background: "#2a7a5a",
        color: "#fff", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14,
      }}>
        Try again
      </button>
    </div>
  )
}

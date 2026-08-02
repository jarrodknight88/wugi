"use client"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="dash-page" style={{
      display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12,
    }}>
      <div style={{
        background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)", padding: 32, width: "100%", maxWidth: 520,
      }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#111827", margin: "0 0 8px" }}>
          Something went wrong loading this page
        </h1>
        <p style={{ fontSize: 14, color: "#6b7280", margin: "0 0 4px" }}>
          Try again, or head back to the Overview if the problem persists.
        </p>
        {error.digest && (
          <p style={{ fontSize: 12, color: "#9ca3af", margin: "8px 0 0" }}>Error digest: {error.digest}</p>
        )}
        <button onClick={() => reset()} style={{
          marginTop: 20, padding: "10px 24px", borderRadius: 8, background: "#2a7a5a",
          color: "#fff", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14,
        }}>
          Try again
        </button>
      </div>
    </div>
  )
}

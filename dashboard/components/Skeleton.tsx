// ─────────────────────────────────────────────────────────────────────
// Shared loading-state primitives — pulse-block skeletons.
// Composed by each route's loading.tsx to roughly match its layout
// (table rows / card grid / stat tiles) without duplicating markup.
// ─────────────────────────────────────────────────────────────────────

export function Skeleton({
  width = "100%",
  height = 16,
  radius = 6,
  style,
}: {
  width?: number | string
  height?: number | string
  radius?: number
  style?: React.CSSProperties
}) {
  return (
    <div
      className="wg-skeleton"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  )
}

export function SkeletonHeader({ withFilters = true }: { withFilters?: boolean }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <Skeleton height={24} width={180} style={{ marginBottom: 10 }} />
      <Skeleton height={14} width={280} />
      {withFilters && (
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <Skeleton height={32} width={90} radius={8} />
          <Skeleton height={32} width={90} radius={8} />
          <Skeleton height={32} width={90} radius={8} />
        </div>
      )}
    </div>
  )
}

export function SkeletonStatGrid({ count = 5 }: { count?: number }) {
  return (
    <div className="dash-stat-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", border: "1px solid #e5e7eb" }}>
          <Skeleton height={12} width="60%" style={{ marginBottom: 12 }} />
          <Skeleton height={28} width="40%" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonTable({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="dash-table-wrap">
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} style={{ borderBottom: "1px solid #f3f4f6" }}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} style={{ padding: "14px 16px" }}>
                  <Skeleton height={14} width={c === 0 ? "70%" : "50%"} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SkeletonCardGrid({
  count = 6,
  minWidth = 280,
}: {
  count?: number
  minWidth?: number
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`, gap: 16 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 16 }}>
          <Skeleton height={120} radius={8} style={{ marginBottom: 12 }} />
          <Skeleton height={14} width="70%" style={{ marginBottom: 8 }} />
          <Skeleton height={12} width="40%" />
        </div>
      ))}
    </div>
  )
}

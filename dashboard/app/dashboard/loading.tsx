import { Skeleton, SkeletonStatGrid } from "@/components/Skeleton"

export default function DashboardLoading() {
  return (
    <div className="dash-page">
      <div style={{ marginBottom: 28 }}>
        <Skeleton height={24} width={140} style={{ marginBottom: 10 }} />
        <Skeleton height={14} width={320} />
      </div>
      <div className="dash-quick-actions">
        <Skeleton height={36} width={110} radius={8} />
        <Skeleton height={36} width={110} radius={8} />
        <Skeleton height={36} width={130} radius={8} />
      </div>
      <SkeletonStatGrid count={5} />
      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb", padding: "20px 24px" }}>
        <Skeleton height={16} width={160} style={{ marginBottom: 16 }} />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
            <Skeleton height={13} width="60%" />
            <Skeleton height={13} width={70} />
          </div>
        ))}
      </div>
    </div>
  )
}

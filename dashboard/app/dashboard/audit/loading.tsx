import { Skeleton, SkeletonTable } from "@/components/Skeleton"

export default function AuditLoading() {
  return (
    <div className="dash-page">
      <div style={{ marginBottom: 24 }}>
        <Skeleton height={22} width={140} style={{ marginBottom: 8 }} />
        <Skeleton height={14} width={220} />
      </div>
      <SkeletonTable rows={10} cols={4} />
    </div>
  )
}

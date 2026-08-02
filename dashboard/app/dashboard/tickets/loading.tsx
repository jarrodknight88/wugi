import { SkeletonHeader, SkeletonStatGrid, SkeletonTable } from "@/components/Skeleton"

export default function TicketsLoading() {
  return (
    <div className="dash-page">
      <SkeletonHeader withFilters={false} />
      <SkeletonStatGrid count={3} />
      <SkeletonTable rows={8} cols={6} />
    </div>
  )
}

import { SkeletonHeader, SkeletonCardGrid } from "@/components/Skeleton"

export default function SeriesLoading() {
  return (
    <div className="dash-page">
      <SkeletonHeader />
      <SkeletonCardGrid count={6} minWidth={300} />
    </div>
  )
}

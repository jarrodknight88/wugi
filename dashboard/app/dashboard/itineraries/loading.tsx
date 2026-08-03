import { SkeletonHeader, SkeletonCardGrid } from "@/components/Skeleton"

export default function ItinerariesLoading() {
  return (
    <div className="dash-page">
      <SkeletonHeader withFilters={false} />
      <SkeletonCardGrid count={6} minWidth={300} />
    </div>
  )
}

import { SkeletonHeader, SkeletonCardGrid } from "@/components/Skeleton"

export default function GalleriesLoading() {
  return (
    <div className="dash-page">
      <SkeletonHeader withFilters={false} />
      <SkeletonCardGrid count={6} minWidth={280} />
    </div>
  )
}

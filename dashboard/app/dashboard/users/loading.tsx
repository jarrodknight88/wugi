import { SkeletonHeader, SkeletonTable } from "@/components/Skeleton"

export default function UsersLoading() {
  return (
    <div className="dash-page">
      <SkeletonHeader withFilters={false} />
      <SkeletonTable rows={8} cols={4} />
    </div>
  )
}

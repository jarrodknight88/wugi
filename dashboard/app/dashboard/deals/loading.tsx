import { SkeletonHeader, SkeletonTable } from "@/components/Skeleton"

export default function DealsLoading() {
  return (
    <div className="dash-page">
      <SkeletonHeader />
      <SkeletonTable rows={8} cols={5} />
    </div>
  )
}

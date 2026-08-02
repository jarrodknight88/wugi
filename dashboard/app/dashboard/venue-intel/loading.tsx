import { SkeletonHeader, SkeletonTable } from "@/components/Skeleton"

export default function VenueIntelLoading() {
  return (
    <div className="dash-page">
      <SkeletonHeader />
      <SkeletonTable rows={8} cols={4} />
    </div>
  )
}

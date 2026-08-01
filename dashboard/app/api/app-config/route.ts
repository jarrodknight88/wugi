import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireAppConfigStaff } from "@/lib/appConfigAuth"
import { logAuditServer } from "@/lib/serverAuditLog"

export const dynamic = "force-dynamic"

// Mirrors mobile-app/src/lib/remoteConfig.ts's ImageMode union and
// DEFAULT_CONFIG — this route is the only writer of config/appConfig, so
// these two lists must be kept in sync with that file by hand.
const IMAGE_MODES = ["two-image", "dynamic"] as const
type ImageMode = (typeof IMAGE_MODES)[number]

const DEFAULTS = {
  minSupportedVersion: "0.0.0",
  imageMode: "two-image" as ImageMode,
}

// Standard semver (major.minor.patch, optional -prerelease/+build).
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

type AppConfigDoc = {
  minSupportedVersion: string
  imageMode: ImageMode
  minSupportedVersionUpdatedBy: string | null
  minSupportedVersionUpdatedAt: string | null
  imageModeUpdatedBy: string | null
  imageModeUpdatedAt: string | null
}

function toResponseDoc(data: FirebaseFirestore.DocumentData | undefined): AppConfigDoc {
  return {
    minSupportedVersion:
      typeof data?.minSupportedVersion === "string" && data.minSupportedVersion.length > 0
        ? data.minSupportedVersion
        : DEFAULTS.minSupportedVersion,
    imageMode: data?.imageMode === "dynamic" ? "dynamic" : DEFAULTS.imageMode,
    minSupportedVersionUpdatedBy: data?.minSupportedVersionUpdatedBy ?? null,
    minSupportedVersionUpdatedAt: data?.minSupportedVersionUpdatedAt?.toDate?.()?.toISOString() ?? null,
    imageModeUpdatedBy: data?.imageModeUpdatedBy ?? null,
    imageModeUpdatedAt: data?.imageModeUpdatedAt?.toDate?.()?.toISOString() ?? null,
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAppConfigStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const snap = await getAdminDb().collection("config").doc("appConfig").get()
  return NextResponse.json(toResponseDoc(snap.exists ? snap.data() : undefined))
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAppConfigStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => null)
  const field = body?.field
  const value = body?.value

  if (field !== "minSupportedVersion" && field !== "imageMode") {
    return NextResponse.json({ error: "field must be 'minSupportedVersion' or 'imageMode'" }, { status: 400 })
  }
  if (typeof value !== "string" || value.length === 0) {
    return NextResponse.json({ error: "value is required" }, { status: 400 })
  }

  if (field === "minSupportedVersion") {
    if (!SEMVER_RE.test(value)) {
      return NextResponse.json({ error: "minSupportedVersion must be a valid semver string (e.g. 5.1.0)" }, { status: 400 })
    }
    // Defense in depth — the dashboard UI requires typing the version again
    // before it will even call this route, but the kill switch is
    // consequential enough to also enforce it server-side.
    if (body?.confirm !== value) {
      return NextResponse.json({ error: "confirm must match value exactly" }, { status: 400 })
    }
  } else {
    if (!IMAGE_MODES.includes(value as ImageMode)) {
      return NextResponse.json({ error: `imageMode must be one of: ${IMAGE_MODES.join(", ")}` }, { status: 400 })
    }
  }

  const docRef = getAdminDb().collection("config").doc("appConfig")
  const before = await docRef.get()
  const beforeData = toResponseDoc(before.exists ? before.data() : undefined)
  const from = field === "minSupportedVersion" ? beforeData.minSupportedVersion : beforeData.imageMode

  if (from === value) {
    return NextResponse.json(beforeData)
  }

  await docRef.set(
    {
      [field]: value,
      [`${field}UpdatedBy`]: auth.email,
      [`${field}UpdatedAt`]: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )

  await logAuditServer({
    adminId: auth.uid,
    adminEmail: auth.email,
    action: "app_config_update",
    targetId: field,
    targetName: `${field}: ${from} → ${value}`,
  })

  const after = await docRef.get()
  return NextResponse.json(toResponseDoc(after.data()))
}

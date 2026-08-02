"use client"
import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuthContext } from "@/context/AuthContext"
import { authedFetch, errorMessage } from "@/lib/authedFetch"

type ImageMode = "two-image" | "dynamic"

type AppConfig = {
  minSupportedVersion: string
  imageMode: ImageMode
  minSupportedVersionUpdatedBy: string | null
  minSupportedVersionUpdatedAt: string | null
  imageModeUpdatedBy: string | null
  imageModeUpdatedAt: string | null
}

const IMAGE_MODE_OPTIONS: { value: ImageMode; label: string }[] = [
  { value: "two-image", label: "two-image" },
  { value: "dynamic", label: "dynamic" },
]

// Same pattern the API route enforces server-side (app/api/app-config/route.ts).
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

const CARD: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: "24px 28px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  border: "1px solid #e5e7eb",
  marginBottom: 24,
}

const INPUT: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  fontSize: 14,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
}

function formatWhen(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleString()
}

function LastChanged({ by, at }: { by: string | null; at: string | null }) {
  if (!by || !at) {
    return <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 12 }}>Never changed via this page.</div>
  }
  return (
    <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 12 }}>
      Last changed by <span style={{ color: "#6b7280", fontWeight: 600 }}>{by}</span> on {formatWhen(at)}
    </div>
  )
}

export default function AppConfigPage() {
  const router = useRouter()
  const { user, loading, role } = useAuthContext()
  // Deliberately role === "super_admin" only — narrower than every other
  // gate in the dashboard (isSuperAdmin/canManageUsers also admit
  // moderator/support). config/appConfig controls the kill switch for
  // every installed build; this page is the strictest tier we have.
  const isAppConfigAdmin = role === "super_admin"

  const [config, setConfig] = useState<AppConfig | null>(null)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState("")

  const [versionInput, setVersionInput] = useState("")
  const [versionConfirm, setVersionConfirm] = useState("")
  const [savingVersion, setSavingVersion] = useState(false)

  const [imageModeInput, setImageModeInput] = useState<ImageMode>("two-image")
  const [savingImageMode, setSavingImageMode] = useState(false)

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
    if (!isAppConfigAdmin) router.replace("/unauthorized")
  }, [loading, user, isAppConfigAdmin, router])

  const load = useCallback(async () => {
    setFetching(true)
    setError("")
    try {
      const data: AppConfig = await authedFetch("/api/app-config")
      setConfig(data)
      setVersionInput(data.minSupportedVersion)
      setImageModeInput(data.imageMode)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setFetching(false)
    }
  }, [])

  useEffect(() => {
    if (!user || !isAppConfigAdmin) return
    load()
  }, [user, isAppConfigAdmin, load])

  async function saveVersion() {
    if (!config) return
    setSavingVersion(true)
    setError("")
    try {
      const data: AppConfig = await authedFetch("/api/app-config", {
        method: "PATCH",
        body: JSON.stringify({ field: "minSupportedVersion", value: versionInput, confirm: versionConfirm }),
      })
      setConfig(data)
      setVersionInput(data.minSupportedVersion)
      setVersionConfirm("")
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSavingVersion(false)
    }
  }

  async function saveImageMode() {
    if (!config) return
    setSavingImageMode(true)
    setError("")
    try {
      const data: AppConfig = await authedFetch("/api/app-config", {
        method: "PATCH",
        body: JSON.stringify({ field: "imageMode", value: imageModeInput }),
      })
      setConfig(data)
      setImageModeInput(data.imageMode)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSavingImageMode(false)
    }
  }

  if (loading || !user || !isAppConfigAdmin) return null

  const versionValid = SEMVER_RE.test(versionInput.trim())
  const versionChanged = config ? versionInput.trim() !== config.minSupportedVersion : false
  const versionConfirmed = versionConfirm.trim() === versionInput.trim()
  const canSaveVersion = versionValid && versionChanged && versionConfirmed && !savingVersion

  const imageModeChanged = config ? imageModeInput !== config.imageMode : false
  const canSaveImageMode = imageModeChanged && !savingImageMode

  return (
      <div className="dash-page">
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827", margin: 0 }}>App Config</h1>
          <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>
            Live controls for <code>config/appConfig</code> — read by every installed build of the consumer app on launch.
          </p>
        </div>

        {error && (
          <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {fetching || !config ? (
          <div style={{ color: "#6b7280", fontSize: 14 }}>Loading...</div>
        ) : (
          <>
            {/* Kill switch */}
            <div style={{ ...CARD, border: "1px solid #fecaca" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: "#991b1b", margin: 0 }}>Minimum Supported Version</h2>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#b91c1c", background: "#fee2e2", padding: "2px 8px", borderRadius: 6 }}>
                  KILL SWITCH
                </span>
              </div>
              <p style={{ fontSize: 13, color: "#6b7280", margin: "8px 0 16px", lineHeight: 1.5 }}>
                Raising this above the live App Store version forces <strong>every user</strong> to update before
                the app opens — installed builds below this version render a blocking "Update Required" screen with
                no dismiss path. Lowering it (or setting it to <code>0.0.0</code>) removes the gate entirely.
              </p>

              <div style={{ fontSize: 48, fontWeight: 800, color: "#111827", lineHeight: 1, marginBottom: 16 }}>
                {config.minSupportedVersion}
              </div>

              <div style={{ display: "grid", gap: 10, maxWidth: 360 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
                  New value
                  <input
                    style={{ ...INPUT, marginTop: 4 }}
                    value={versionInput}
                    onChange={e => setVersionInput(e.target.value)}
                    placeholder="e.g. 5.1.0"
                  />
                </label>
                {versionInput.trim().length > 0 && !versionValid && (
                  <div style={{ fontSize: 12, color: "#b91c1c" }}>Must be valid semver (e.g. 5.1.0).</div>
                )}
                {versionChanged && versionValid && (
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#991b1b" }}>
                    Type "{versionInput.trim()}" again to confirm
                    <input
                      style={{ ...INPUT, marginTop: 4, borderColor: "#fca5a5" }}
                      value={versionConfirm}
                      onChange={e => setVersionConfirm(e.target.value)}
                      placeholder={versionInput.trim()}
                    />
                  </label>
                )}
                <button
                  onClick={saveVersion}
                  disabled={!canSaveVersion}
                  style={{
                    padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, border: "none",
                    background: canSaveVersion ? "#b91c1c" : "#f3f4f6",
                    color: canSaveVersion ? "#fff" : "#9ca3af",
                    cursor: canSaveVersion ? "pointer" : "not-allowed",
                  }}
                >
                  {savingVersion ? "Saving..." : "Save minSupportedVersion"}
                </button>
              </div>

              <LastChanged by={config.minSupportedVersionUpdatedBy} at={config.minSupportedVersionUpdatedAt} />
            </div>

            {/* imageMode flag */}
            <div style={CARD}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "#111827", margin: 0 }}>Image Mode</h2>
              <p style={{ fontSize: 13, color: "#6b7280", margin: "8px 0 16px", lineHeight: 1.5 }}>
                Switches the media layout every device fetches on next launch — no App Store review needed.
                <code>two-image</code> is the original fixed two-photo layout; <code>dynamic</code> lets event
                cards render a variable number of images.
              </p>

              <div style={{ fontSize: 32, fontWeight: 800, color: "#111827", lineHeight: 1, marginBottom: 16 }}>
                {config.imageMode}
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <select
                  value={imageModeInput}
                  onChange={e => setImageModeInput(e.target.value as ImageMode)}
                  style={{ ...INPUT, width: "auto", minWidth: 160 }}
                >
                  {IMAGE_MODE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <button
                  onClick={saveImageMode}
                  disabled={!canSaveImageMode}
                  style={{
                    padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, border: "none",
                    background: canSaveImageMode ? "#2a7a5a" : "#f3f4f6",
                    color: canSaveImageMode ? "#fff" : "#9ca3af",
                    cursor: canSaveImageMode ? "pointer" : "not-allowed",
                  }}
                >
                  {savingImageMode ? "Saving..." : "Save imageMode"}
                </button>
              </div>

              <LastChanged by={config.imageModeUpdatedBy} at={config.imageModeUpdatedAt} />
            </div>
          </>
        )}
      </div>
  )
}

"use client"
import { useEffect, useRef } from "react"

// In-page confirm modal — replaces window.confirm across media flows (issue
// #183). window.confirm bit us twice: Chrome's "prevent additional dialogs"
// latch (set once a user dismisses enough native dialogs) makes confirm()
// silently return false forever after, with zero visible feedback — on
// VenueMediaPanel's save gate that looked like Save doing nothing at all
// (zero PATCH requests, no error). This dialog can't be suppressed that way.
export default function ConfirmDialog({
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: {
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  // Focus starts on Cancel (the safe default) and Tab is trapped between the
  // two buttons — this is a two-control dialog, no need for a full
  // tabbable-elements scan.
  useEffect(() => {
    cancelRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onCancel(); return }
      if (e.key !== "Tab") return
      const first = cancelRef.current
      const last = confirmRef.current
      if (!first || !last) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onCancel])

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 2100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      // stopPropagation — this dialog is often rendered nested inside another
      // modal's own overlay-click-to-close div; without this, cancelling the
      // confirm would bubble up and close that parent modal too.
      onClick={(e) => { e.stopPropagation(); onCancel() }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={message}
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", padding: 24 }}
      >
        <p style={{ margin: "0 0 20px", fontSize: 14, color: "#374151", lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button ref={cancelRef} type="button" onClick={onCancel} style={{ padding: "9px 18px", borderRadius: 8, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151" }}>
            {cancelLabel}
          </button>
          <button ref={confirmRef} type="button" onClick={onConfirm} style={{ padding: "9px 18px", borderRadius: 8, background: "#111827", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

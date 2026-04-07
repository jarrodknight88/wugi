#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# Wugi Door — Build & Auto-Submit to TestFlight
# Run: bash /Users/jarrod/Documents/GitHub/wugi/check-in-app/scripts/build-testflight.sh
# ─────────────────────────────────────────────────────────────────────

set -e
APP_DIR="/Users/jarrod/Documents/GitHub/wugi/check-in-app"
cd "$APP_DIR"

# ── Step 1: Full sanity check (catches crash causes before building) ──
bash "$APP_DIR/scripts/sanity-check.sh"
if [ $? -ne 0 ]; then
  echo ""
  echo "🛑 Build aborted — fix sanity check failures first"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🚪 Wugi Door — Submitting Build to TestFlight"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Step 2: Commit any uncommitted changes ────────────────────────────
cd /Users/jarrod/Documents/GitHub/wugi
UNCOMMITTED=$(git diff --name-only HEAD 2>/dev/null)
UNTRACKED=$(git ls-files --others --exclude-standard check-in-app/src check-in-app/App.tsx check-in-app/app.json check-in-app/package.json 2>/dev/null)
if [ -n "$UNCOMMITTED" ] || [ -n "$UNTRACKED" ]; then
  echo "▶ Committing changes before build..."
  git add -A
  git commit -m "chore: pre-build commit $(date '+%Y-%m-%d %H:%M')"
  git push origin main
  echo "✅ Committed and pushed"
  echo ""
fi
cd "$APP_DIR"

# ── Step 3: EAS Build + Auto Submit ──────────────────────────────────
echo "▶ Starting EAS build with auto-submit to TestFlight..."
echo "   (Close terminal after 'Build queued' — runs on Expo servers)"
echo ""
eas build --platform ios --profile production --auto-submit

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Build queued — will auto-submit to TestFlight!"
echo "  Monitor: https://expo.dev/accounts/phatbat/projects/wugi-door/builds"
echo "  TestFlight: https://appstoreconnect.apple.com/apps/6761620569/testflight/ios"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

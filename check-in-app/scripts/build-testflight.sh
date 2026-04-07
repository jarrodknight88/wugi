#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# Wugi Door — Build & Auto-Submit to TestFlight
# Run: bash /Users/jarrod/Documents/GitHub/wugi/check-in-app/scripts/build-testflight.sh
# ─────────────────────────────────────────────────────────────────────

set -e
APP_DIR="/Users/jarrod/Documents/GitHub/wugi/check-in-app"
cd "$APP_DIR"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🚪 Wugi Door — Build & Submit to TestFlight"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 1 — Local bundle check (catches errors before wasting EAS time)
echo "▶ Step 1/2 — Local bundle check..."
npx expo export --platform ios --output-dir /tmp/wugi-door-export --clear
echo "✅ Bundle clean"
echo ""

# Step 2 — EAS Build + Auto Submit in one command
# --auto-submit automatically submits to TestFlight when build completes
# You can close the terminal after "Build queued" appears — it runs on EAS servers
echo "▶ Step 2/2 — Building & submitting to TestFlight..."
echo "   (You can close the terminal once the build is queued — it runs on Expo's servers)"
echo ""
eas build --platform ios --profile production --auto-submit

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Build queued & will auto-submit to TestFlight!"
echo "  Monitor: https://expo.dev/accounts/phatbat/projects/wugi-door/builds"
echo "  TestFlight: https://appstoreconnect.apple.com/apps/6761620569/testflight/ios"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

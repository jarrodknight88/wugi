#!/bin/zsh
# ─────────────────────────────────────────────────────────────
# Wugi — TestFlight build + auto-submit
# Runs pre-build check, builds, and submits to TestFlight in one go.
# Usage: ./scripts/build-testflight.sh
# ─────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$REPO_ROOT/mobile-app"

echo ""
echo "╔════════════════════════════════════════════════╗"
echo "║     Wugi — TestFlight Build + Submit           ║"
echo "╚════════════════════════════════════════════════╝"
echo ""

# ── Pre-build check ─────────────────────────────────────────
echo "── Running pre-build check..."
"$SCRIPT_DIR/pre-build-check.sh"
echo ""

# ── Build + auto-submit ─────────────────────────────────────
echo "── Starting EAS TestFlight build (auto-submit enabled)..."
cd "$APP_DIR"
# NOTE: --non-interactive works only if a valid provisioning profile exists in EAS.
# If the build fails with "Associated Domains" or provisioning profile errors, run:
#   npx eas-cli credentials → iOS → testflight → Provisioning Profile → Delete
# Then re-run this script WITHOUT --non-interactive so EAS can auth with Apple
# and regenerate a fresh profile including all current entitlements.
npx eas-cli build \
  --platform ios \
  --profile testflight \
  --auto-submit \
  --non-interactive

echo ""
echo "✅ Build queued and will auto-submit to TestFlight when complete."
echo "   Check status: npx eas-cli build:list --platform ios --limit 3 --non-interactive"

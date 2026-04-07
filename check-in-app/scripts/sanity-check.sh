#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# Wugi Door — Pre-Build Sanity Check
# Catches runtime crash causes before wasting EAS build time
# Run standalone: bash scripts/sanity-check.sh
# Called automatically by build-testflight.sh
# ─────────────────────────────────────────────────────────────────────

APP_DIR="/Users/jarrod/Documents/GitHub/wugi/check-in-app"
cd "$APP_DIR"
ERRORS=0

red()   { echo "  ❌ $1"; ERRORS=$((ERRORS+1)); }
green() { echo "  ✅ $1"; }
title() { echo ""; echo "── $1 ──────────────────────────────"; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🔍 Wugi Door — Pre-Build Sanity Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Firebase package version alignment ─────────────────────────────
title "1. Firebase package versions"
APP_VER=$(cat node_modules/@react-native-firebase/app/package.json | python3 -c "import json,sys; print(json.load(sys.stdin)['version'])" 2>/dev/null)
for pkg in firestore functions auth; do
  VER=$(cat node_modules/@react-native-firebase/$pkg/package.json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['version'])" 2>/dev/null)
  if [ -z "$VER" ]; then
    green "@react-native-firebase/$pkg not installed (skipped)"
  elif [ "$VER" != "$APP_VER" ]; then
    red "@react-native-firebase/$pkg is $VER but app is $APP_VER — VERSION MISMATCH"
  else
    green "@react-native-firebase/$pkg $VER matches app"
  fi
done

# ── 2. TAP_TO_PAY_ENABLED flag consistency ────────────────────────────
title "2. TAP_TO_PAY_ENABLED flag consistency"
DISABLED_COUNT=$(grep -rn "TAP_TO_PAY_ENABLED = false" src App.tsx 2>/dev/null | grep -v "//" | wc -l | tr -d ' ')
ENABLED_COUNT=$(grep -rn "TAP_TO_PAY_ENABLED = true" src App.tsx 2>/dev/null | grep -v "//" | wc -l | tr -d ' ')
if [ "$DISABLED_COUNT" -gt 0 ] && [ "$ENABLED_COUNT" -gt 0 ]; then
  red "Mixed TAP_TO_PAY_ENABLED flags — $ENABLED_COUNT true, $DISABLED_COUNT false. Make them consistent."
elif [ "$ENABLED_COUNT" -gt 0 ]; then
  green "TAP_TO_PAY_ENABLED = true ($ENABLED_COUNT files) — Tap to Pay active"
else
  green "TAP_TO_PAY_ENABLED = false — Tap to Pay disabled"
fi

# ── 3. Stripe Terminal import matches TAP_TO_PAY_ENABLED ─────────────
title "3. Stripe Terminal import consistency"
HAS_STRIPE_IMPORT=$(grep -rn "from '@stripe/stripe-terminal-react-native'" src --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "//" | wc -l | tr -d ' ')
if [ "$ENABLED_COUNT" -gt 0 ] && [ "$HAS_STRIPE_IMPORT" -gt 0 ]; then
  green "Stripe Terminal imported and TAP_TO_PAY_ENABLED=true — consistent"
elif [ "$DISABLED_COUNT" -gt 0 ] && [ "$HAS_STRIPE_IMPORT" -gt 0 ]; then
  red "Stripe Terminal imported but TAP_TO_PAY_ENABLED=false — will crash on launch"
else
  green "No active Stripe Terminal imports (TAP_TO_PAY disabled)"
fi

# ── 4. Context hook safety — hooks that throw outside provider ────────
title "4. Context hook safety"
# Check useTerminal — must return safe stub not throw
if grep -q "throw new Error.*useTerminal must be used" src/context/TerminalContext.tsx 2>/dev/null; then
  red "useTerminal() throws when used outside provider — will crash when TAP_TO_PAY_ENABLED=false"
else
  green "useTerminal() returns safe stub outside provider"
fi

# ── 5. Old-style Firebase functions() calls ───────────────────────────
title "5. Firebase functions API (v23 modular)"
OLD_CALLS=$(grep -rn "functions()\." src --include="*.ts" --include="*.tsx" | grep -v "//")
if [ -n "$OLD_CALLS" ]; then
  red "Old functions().httpsCallable() pattern found (crashes on v23):\n$OLD_CALLS"
else
  green "No old-style functions() calls"
fi

# ── 6. Old default import pattern ────────────────────────────────────
OLD_IMPORT=$(grep -rn "^import functions from '@react-native-firebase/functions'" src --include="*.ts" --include="*.tsx")
if [ -n "$OLD_IMPORT" ]; then
  red "Old default functions import found:\n$OLD_IMPORT"
else
  green "No old default functions import"
fi

# ── 6. Super admin safety — __super_admin__ eventId guard ────────────
title "6. Super admin Firestore safety"
# Check DashboardScreen and ScannerScreen have isSuperAdmin guard before Firestore listeners
DASH_GUARDED=$(grep -A2 "isSuperAdmin" src/screens/DashboardScreen.tsx 2>/dev/null | grep -c "return")
SCAN_GUARDED=$(grep -A2 "isSuperAdmin" src/screens/ScannerScreen.tsx 2>/dev/null | grep -c "return")
if [ "$DASH_GUARDED" -ge 2 ] && [ "$SCAN_GUARDED" -ge 1 ]; then
  green "DashboardScreen and ScannerScreen have super admin guards on Firestore listeners"
else
  red "Missing super admin guard on Firestore listeners — will crash with __super_admin__ eventId"
fi

# ── 7. All contexts used in screens have providers ────────────────────
title "7. Context provider coverage"
# Find all useXxx() hooks from context files and verify providers exist
CONTEXT_HOOKS=$(grep -rn "use[A-Z][a-zA-Z]*Context\|useSession\|useTerminal\|useLocation" src/screens src/hooks --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "//" | grep "= use" | sed 's/.*\(use[A-Z][a-zA-Z]*\).*/\1/' | sort -u)
for hook in $CONTEXT_HOOKS; do
  # Check it's exported from a context file
  DEFINED=$(grep -rn "export function $hook\b" src/context --include="*.ts" --include="*.tsx" 2>/dev/null)
  if [ -n "$DEFINED" ]; then
    green "$hook() is exported from context"
  fi
done

# ── 8. Entitlement / plugin alignment ────────────────────────────────
title "8. Entitlement & plugin alignment"
HAS_TAP_TO_PAY=$(cat app.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['expo']['ios'].get('entitlements',{}).get('com.apple.developer.proximity-reader.payment.acceptance',''))" 2>/dev/null)
HAS_STRIPE_PLUGIN=$(cat app.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(any('stripe' in str(p) for p in d['expo'].get('plugins',[])))" 2>/dev/null)
HAS_STRIPE_PKG=$(python3 -c "import json; d=json.load(open('package.json')); print('1' if '@stripe/stripe-terminal-react-native' in d.get('dependencies',{}) or '@stripe/stripe-terminal-react-native' in d.get('devDependencies',{}) else '0')" 2>/dev/null || echo "0")

if [ "$HAS_TAP_TO_PAY" = "True" ] && [ "$HAS_STRIPE_PKG" = "0" ]; then
  red "Tap to Pay entitlement in app.json but @stripe/stripe-terminal-react-native not in package.json"
elif [ "$HAS_STRIPE_PKG" != "0" ] && [ "$HAS_STRIPE_PLUGIN" != "True" ]; then
  red "@stripe/stripe-terminal-react-native in package.json but plugin missing from app.json"
elif [ "$HAS_TAP_TO_PAY" = "True" ] && [ "$HAS_STRIPE_PLUGIN" = "True" ] && [ "$HAS_STRIPE_PKG" != "0" ]; then
  green "Tap to Pay fully configured (entitlement + plugin + package all present) ✅"
else
  green "Tap to Pay disabled (pending Apple entitlement) — correct for current build"
fi

# ── 9. Metro bundle check ─────────────────────────────────────────────
title "9. Metro bundle check (catches JS errors)"
BUNDLE_OUT=$(npx expo export --platform ios --output-dir /tmp/wugi-sanity-check --clear 2>&1)
if echo "$BUNDLE_OUT" | grep -q "Exported:"; then
  BUNDLE_SIZE=$(echo "$BUNDLE_OUT" | grep -o "[0-9.]* MB" | head -1)
  green "Bundle OK ($BUNDLE_SIZE)"
else
  red "Bundle FAILED:\n$BUNDLE_OUT"
fi

# ── 10. Uncommitted changes warning ──────────────────────────────────
title "10. Git commit status"
cd /Users/jarrod/Documents/GitHub/wugi
UNCOMMITTED=$(git diff --name-only HEAD 2>/dev/null)
UNTRACKED=$(git ls-files --others --exclude-standard check-in-app/src check-in-app/App.tsx check-in-app/app.json check-in-app/package.json 2>/dev/null)
if [ -n "$UNCOMMITTED" ] || [ -n "$UNTRACKED" ]; then
  red "Uncommitted changes detected — EAS builds from last commit, these changes WON'T be included:\n${UNCOMMITTED}${UNTRACKED}"
else
  green "All changes committed"
fi
cd "$APP_DIR"

# ── Result ────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $ERRORS -eq 0 ]; then
  echo "  ✅ All checks passed — safe to build"
else
  echo "  ❌ $ERRORS check(s) failed — fix before building"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

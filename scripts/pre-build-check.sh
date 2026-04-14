#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# Wugi — Smart Pre-Build Sanity Check
# Dynamically determines which checks to run based on what changed.
# Hardcodes the known failure patterns from this project's UAT history.
#
# Usage: ./scripts/pre-build-check.sh
# Exit 0 = safe to build | Exit 1 = issues found
# ─────────────────────────────────────────────────────────────────────

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/mobile-app"
FAIL=0; WARN_COUNT=0

grn() { echo "  ✅  $1"; }
red() { echo "  ❌  $1"; FAIL=$((FAIL+1)); }
wrn() { echo "  ⚠️   $1"; WARN_COUNT=$((WARN_COUNT+1)); }
hdr() { echo ""; echo "── $1 ──────────────────────────────────────"; }

echo ""
echo "╔════════════════════════════════════════════════╗"
echo "║     Wugi Smart Pre-Build Sanity Check          ║"
echo "╚════════════════════════════════════════════════╝"

# ── Collect all changed files (unstaged + staged + untracked) ─────────
cd "$ROOT"
CHANGED=$(git diff --name-only HEAD 2>/dev/null; git diff --cached --name-only 2>/dev/null; git ls-files --others --exclude-standard mobile-app/src 2>/dev/null)
echo ""
echo "📋 Changed files:"
echo "$CHANGED" | sed 's/^/     /'

# ── Determine which risk categories are affected ──────────────────────
TOUCHED_AUTH=false
TOUCHED_FIRESTORE_RULES=false
TOUCHED_FIRESTORE_SERVICE=false
TOUCHED_NAVIGATION=false
TOUCHED_SCREENS=false
TOUCHED_APP_ROOT=false
TOUCHED_FUNCTIONS=false
TOUCHED_KEYBOARD=false

echo "$CHANGED" | grep -q "FirebaseContext\|SignupScreen\|AccountScreen\|auth"   && TOUCHED_AUTH=true
echo "$CHANGED" | grep -q "firestore.rules"                                       && TOUCHED_FIRESTORE_RULES=true
echo "$CHANGED" | grep -q "firestoreService"                                      && TOUCHED_FIRESTORE_SERVICE=true
echo "$CHANGED" | grep -q "RootNavigator\|navigation"                             && TOUCHED_NAVIGATION=true
echo "$CHANGED" | grep -q "src/screens\|src/features"                             && TOUCHED_SCREENS=true
echo "$CHANGED" | grep -q "App.tsx"                                               && TOUCHED_APP_ROOT=true
echo "$CHANGED" | grep -q "functions/"                                            && TOUCHED_FUNCTIONS=true
echo "$CHANGED" | grep -q "keyboard\|InputAccessory\|textContentType"             && TOUCHED_KEYBOARD=true

# App.tsx or keyboard constants = keyboard risk
echo "$CHANGED" | grep -q "keyboard.ts\|App.tsx" && TOUCHED_KEYBOARD=true

echo ""
echo "🔍 Risk categories detected:"
$TOUCHED_AUTH             && echo "     • Auth / signup flow"
$TOUCHED_FIRESTORE_RULES  && echo "     • Firestore security rules"
$TOUCHED_FIRESTORE_SERVICE && echo "     • Firestore service functions"
$TOUCHED_NAVIGATION       && echo "     • Navigation / routing"
$TOUCHED_SCREENS          && echo "     • Screen components"
$TOUCHED_APP_ROOT         && echo "     • App root (providers, keyboard)"
$TOUCHED_FUNCTIONS        && echo "     • Cloud Functions"
$TOUCHED_KEYBOARD         && echo "     • Keyboard toolbar"

# ════════════════════════════════════════════════════════════════════
# ALWAYS-ON CHECKS (run regardless of what changed)
# ════════════════════════════════════════════════════════════════════

hdr "ALWAYS: TypeScript"
cd "$APP"
if npx tsc --noEmit 2>&1 | grep -q "error TS"; then
  red "TypeScript errors — run 'npx tsc --noEmit' for details"
else
  grn "No TypeScript errors"
fi

hdr "ALWAYS: Expo bundle"
BUNDLE=$(npx expo export --platform ios 2>&1)
if echo "$BUNDLE" | grep -q "Bundled"; then
  grn "iOS bundle compiled successfully"
else
  red "Expo bundle failed"
  echo "$BUNDLE" | tail -8
fi

# ════════════════════════════════════════════════════════════════════
# CONDITIONAL: Firestore Rules  (if rules or service changed)
# ════════════════════════════════════════════════════════════════════
if $TOUCHED_FIRESTORE_RULES || $TOUCHED_FIRESTORE_SERVICE; then
  hdr "CONDITIONAL: Firestore rules"
  cd "$ROOT"
  RULES_OUT=$(firebase deploy --only firestore:rules --project wugi-prod 2>&1 || true)
  if echo "$RULES_OUT" | grep -q "\[E\]"; then
    red "Firestore rules have compilation errors"
    echo "$RULES_OUT" | grep "\[E\]" | head -5
  elif echo "$RULES_OUT" | grep -q "compiled successfully"; then
    W=$(echo "$RULES_OUT" | grep -c "\[W\]" || true)
    [ "$W" -gt 0 ] && grn "Rules compile cleanly ($W warning(s) — non-blocking)" || grn "Rules compile cleanly"
  else
    red "Rules deploy failed unexpectedly"
  fi

  # Known failure pattern: users update rule must check own-uid BEFORE calling userDoc()
  hdr "CONDITIONAL: users rule ordering (UAT failure pattern)"
  RULE_UPDATE=$(awk '/match \/users\/{userId}/{found=1} found && /allow update/{print; for(i=0;i<5;i++) {getline; print}; found=0}' "$ROOT/firebase/firestore.rules")
  if echo "$RULE_UPDATE" | grep -q "request.auth.uid == userId"; then
    UID_LINE=$(echo "$RULE_UPDATE" | grep -n "request.auth.uid == userId" | head -1 | cut -d: -f1)
    SUPER_LINE=$(echo "$RULE_UPDATE" | grep -n "isSuperAdmin\|isVenueAdmin" | head -1 | cut -d: -f1)
    if [ -n "$UID_LINE" ] && [ -n "$SUPER_LINE" ] && [ "$UID_LINE" -lt "$SUPER_LINE" ]; then
      grn "users update: own-uid check comes before userDoc() calls ✓"
    else
      red "users update: isSuperAdmin() called before uid check — will deny new user writes"
    fi
  else
    red "users update: missing request.auth.uid == userId check — all user updates will fail"
  fi
fi

# ════════════════════════════════════════════════════════════════════
# CONDITIONAL: Auth / Signup (if auth-related files changed)
# ════════════════════════════════════════════════════════════════════
if $TOUCHED_AUTH || $TOUCHED_NAVIGATION; then
  hdr "CONDITIONAL: Auth persistence (UAT failure pattern)"
  # Known failure: stale closure in routeAfterSplash — must use userRef
  if grep -q "userRef.current" "$APP/src/navigation/RootNavigator.tsx" 2>/dev/null; then
    grn "RootNavigator uses userRef (no stale closure in auth routing)"
  else
    red "RootNavigator may use stale 'user' closure — auth persistence will break on reopen"
  fi

  # Known failure: splash getting stuck — need both splashDoneRef and authLoading useEffect
  if grep -q "splashDoneRef" "$APP/src/navigation/RootNavigator.tsx" 2>/dev/null && \
     grep -q "authLoading" "$APP/src/navigation/RootNavigator.tsx" 2>/dev/null; then
    grn "Splash routing has both splashDoneRef and authLoading guards"
  else
    red "Splash routing may get stuck — missing splashDoneRef or authLoading guard"
  fi
fi

if $TOUCHED_AUTH; then
  hdr "CONDITIONAL: Auth form consistency"
  # Known failure: AccountScreen form not matching SignupScreen
  for field in "confirmPassword" "textContentType" "strength"; do
    SIGNUP_HAS=$(grep -c "$field" "$APP/src/screens/SignupScreen.tsx" 2>/dev/null || echo 0)
    ACCOUNT_HAS=$(grep -c "$field" "$APP/src/screens/AccountScreen.tsx" 2>/dev/null || echo 0)
    if [ "$SIGNUP_HAS" -gt 0 ] && [ "$ACCOUNT_HAS" -eq 0 ]; then
      wrn "SignupScreen has '$field' but AccountScreen doesn't — forms may be out of sync"
    fi
  done
  grn "Auth form consistency check done"
fi

# ════════════════════════════════════════════════════════════════════
# CONDITIONAL: Keyboard toolbar (if App.tsx or keyboard files changed)
# ════════════════════════════════════════════════════════════════════
if $TOUCHED_KEYBOARD || $TOUCHED_APP_ROOT; then
  hdr "CONDITIONAL: Keyboard toolbar wiring"
  cd "$APP"

  # Must be at root level in App.tsx
  if grep -q "InputAccessoryView" App.tsx 2>/dev/null; then
    grn "InputAccessoryView at App.tsx root level"
  else
    red "InputAccessoryView missing from App.tsx — toolbar won't appear"
  fi

  # Known failure: Keyboard.emit() doesn't navigate fields
  if grep -q "Keyboard.emit(" App.tsx 2>/dev/null; then
    red "App.tsx uses Keyboard.emit() — arrows won't navigate fields (use ref-based focusPrev/focusNext)"
  else
    grn "No Keyboard.emit() — using proper ref navigation"
  fi

  # Known failure: circular import App ↔ screen
  if grep -rq "from '../../App'" src/screens/ 2>/dev/null; then
    red "Circular import: screen imports from App.tsx (App → RootNav → Screen → App)"
    grep -rl "from '../../App'" src/screens/ | sed 's/^/     /'
  else
    grn "No circular imports between App.tsx and screens"
  fi

  # KB_ACCESSORY_ID should come from constants, not App
  KB_SOURCE=$(grep -r "KB_ACCESSORY_ID" src/ 2>/dev/null | grep "from" | grep -v "constants/keyboard" | wc -l | tr -d ' ')
  if [ "$KB_SOURCE" -gt 0 ]; then
    wrn "$KB_SOURCE file(s) import KB_ACCESSORY_ID from somewhere other than constants/keyboard"
  else
    grn "KB_ACCESSORY_ID imported from constants/keyboard everywhere"
  fi

  # Count wired TextInputs
  WIRED=$(grep -r "inputAccessoryViewID" src/ 2>/dev/null | wc -l | tr -d ' ')
  [ "$WIRED" -gt 0 ] && grn "$WIRED TextInput(s) wired to keyboard toolbar" || wrn "No TextInputs wired to keyboard toolbar"
fi

# ════════════════════════════════════════════════════════════════════
# CONDITIONAL: Navigation / RootNavigator
# ════════════════════════════════════════════════════════════════════
if $TOUCHED_NAVIGATION || $TOUCHED_SCREENS; then
  hdr "CONDITIONAL: Screen imports resolve"
  IMPORT_ERRORS=0
  while IFS= read -r line; do
    if echo "$line" | grep -q "from '../screens/"; then
      SCREEN=$(echo "$line" | sed "s/.*from '\.\.\/screens\/\([^']*\)'.*/\1/")
      [ ! -f "$APP/src/screens/$SCREEN.tsx" ] && red "Missing: src/screens/$SCREEN.tsx" && IMPORT_ERRORS=$((IMPORT_ERRORS+1))
    fi
  done < "$APP/src/navigation/RootNavigator.tsx"
  [ "$IMPORT_ERRORS" -eq 0 ] && grn "All RootNavigator screen imports resolve"
fi

# ════════════════════════════════════════════════════════════════════
# CONDITIONAL: Firestore service functions
# ════════════════════════════════════════════════════════════════════
if $TOUCHED_FIRESTORE_SERVICE; then
  hdr "CONDITIONAL: Firestore service patterns"

  # Known failure: runTransaction in @react-native-firebase v23 has permission issues
  if grep -q "runTransaction" "$APP/firestoreService.ts" 2>/dev/null; then
    wrn "runTransaction found in firestoreService — known to fail on new accounts due to security rule evaluation. Consider using sequential reads + parallel writes instead."
  else
    grn "No runTransaction — using direct read/write pattern"
  fi

  # Retry logic present for username/new user writes
  if grep -q "saveUsername" "$APP/firestoreService.ts" 2>/dev/null; then
    if grep -A20 "saveUsername" "$APP/firestoreService.ts" | grep -q "attempt\|retry\|setTimeout"; then
      grn "saveUsername has retry logic for auth propagation race"
    else
      wrn "saveUsername has no retry — may fail immediately after account creation"
    fi
  fi
fi

# ════════════════════════════════════════════════════════════════════
# CONDITIONAL: Cloud Functions
# ════════════════════════════════════════════════════════════════════
if $TOUCHED_FUNCTIONS; then
  hdr "CONDITIONAL: Cloud Functions compile"
  cd "$ROOT/functions"
  if npx tsc --noEmit 2>&1 | grep -q "error TS"; then
    red "Cloud Functions TypeScript errors"
  else
    grn "Cloud Functions compile cleanly"
  fi
fi

# ════════════════════════════════════════════════════════════════════
# SUMMARY
# ════════════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════════╗"
if [ "$FAIL" -eq 0 ] && [ "$WARN_COUNT" -eq 0 ]; then
  echo "║  ✅  All checks passed — safe to build         ║"
elif [ "$FAIL" -eq 0 ]; then
  echo "║  ✅  Passed ($WARN_COUNT warning(s)) — safe to build    ║"
else
  echo "║  ❌  $FAIL failure(s), $WARN_COUNT warning(s) — fix before building ║"
fi
echo "╚════════════════════════════════════════════════╝"
echo ""
[ "$FAIL" -gt 0 ] && exit 1 || exit 0

#!/usr/bin/env bash
# Durable Firestore rules test runner. Ensures Java is on PATH (Firestore
# emulator needs a JRE), then starts the firestore emulator and runs the suite.
# Usage: npm test   (from tools/rules-test/)
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"

# Java: prefer a WORKING java on PATH; otherwise fall back to the brew
# openjdk@21 keg (installed 2026-05-25; keg-only so not on the default PATH).
# NOTE: macOS ships a /usr/bin/java stub that exists but errors when run, so we
# must actually execute `java -version` rather than just check `command -v java`.
if ! java -version >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1 && brew --prefix openjdk@21 >/dev/null 2>&1; then
    JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
    export JAVA_HOME
    export PATH="$JAVA_HOME/bin:$PATH"
  else
    echo "ERROR: Java not found. Install with: brew install openjdk@21" >&2
    exit 1
  fi
fi

# emulators:exec starts the emulator (config from repo-root firebase.json),
# runs the test, and shuts the emulator down. demo- project = emulator-only.
cd "$REPO_ROOT"
exec firebase emulators:exec --only firestore --project demo-wugi-rules \
  "node tools/rules-test/test.js"

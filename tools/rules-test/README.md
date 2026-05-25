# Firestore rules test (emulator)

Durable harness for testing `firebase/firestore.rules` against the Firestore
emulator using `@firebase/rules-unit-testing`. Set up 2026-05-25 to support the
pre-launch read-hardening work (Asana `1215108652658606`).

## One-time setup
```bash
# 1. Java (Firestore emulator needs a JRE). openjdk@21 via Homebrew (no sudo):
brew install openjdk@21
# 2. Test deps:
cd tools/rules-test && npm install
```

`openjdk@21` is keg-only (not on the default PATH). Two options so runs don't
need a manual prefix:
- **Persisted** (done on Jarrod's machine): `~/.zshrc` exports `JAVA_HOME`/`PATH`
  for `openjdk@21`.
- **Self-contained**: `run.sh` auto-falls back to the brew `openjdk@21` keg if
  `java` isn't already on PATH — so `npm test` works even without the `.zshrc`
  export.

## Run
```bash
cd tools/rules-test && npm test
```
This starts the firestore emulator (config in repo-root `firebase.json`), runs
the suite, and shuts the emulator down — one command.

## What it checks
19 checks: favorites (F1–F7), reports (R1–R6), sanity on existing collections
(S1–S6). **Enforced** checks (write locks + existing read behavior) must pass —
the suite exits non-zero if any enforced check fails. **Gate** checks `F5`/`R5`
(non-owner READ of favorites/reports) are the acceptance criteria for the
catch-all read-hardening; they FAIL today on purpose (the catch-all grants any
authed user broad read) and flip to PASS once reads are hardened.

When you do the read-hardening, run this after each rules edit; the goal is
"all enforced pass" **and** "gate CLOSED", across consumer + Door + web reads
(extend the sanity checks to cover Door `terminalPayments`/`tables` + web
`photos` before deploying).

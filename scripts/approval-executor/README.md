# Approval Executor (`us.wugi.approvals`)

Resident daemon for the Air: listens for Jarrod's Telegram `MERGE n` /
`DEPLOY n` / `HOLD n` replies and executes them immediately, after
re-running a safety gate, instead of waiting for the next scheduled PM
run.

## Design notes — read before wiring this up

This package was built from the issue spec alone. A repo audit at
implementation time found **no existing sweeper daemon, launchd plist,
Telegram bot, or `system/pendingApprovals` / `system/buildBaselines`
Firestore doc anywhere in this codebase or its git history** — so none of
that was "reused"; it's new, and the conventions below were chosen to be
consistent with the one adjacent system that *does* exist:
`functions/src/bridge/` (Bridge v1.4 — Asana ⇄ GitHub ⇄ Twilio SMS,
handling its own `MERGE`/`HOLD`/`REWORK` verbs via SMS and a GitHub-API
squash-merge). Concretely:

- **`system/pendingApprovals` is a single Firestore *document***, whose
  top-level fields are `entryId -> ApprovalEntry` (see `src/types.ts`),
  mirroring the bridge's `system/bridgePrLinks` / `system/bridgeDispatches`
  doc-with-map-of-entries convention — not a growing collection.
- **GitHub/Asana/Telegram clients are hand-rolled `fetch()` calls**, no
  SDK, matching `functions/src/bridge/shared.ts`'s style. Asana's helper is
  intentionally duplicated rather than imported from `functions/src/bridge`
  — the two are independent packages with separate `node_modules`, and the
  task spec forbids touching bridge files.
- **Tests are plain Node `assert/strict` scripts against the compiled
  `lib/` output** (`npm test`), matching `functions/scripts/test-*.js` —
  this repo has no test framework anywhere, so one wasn't introduced here.
- **`system/buildBaselines` is seeded from the root `CLAUDE.md` TypeScript
  baselines table** (`functions: 0`, `mobile-app: 38`, as of 2026-08-02 —
  *not* the `31 / 0` figures in the original task notes, which predate the
  2026-08-02 drift documented in CLAUDE.md). CLAUDE.md is the canonical
  source; if those numbers change, update the seed and re-run
  `npm run seed-baselines` there, not here.
- **The existing bridge (`functions/src/bridge/`) already merges PRs**,
  via Twilio SMS + a live Asana-verdict check + the GitHub API's squash
  merge — a different transport (SMS vs. Telegram), different execution
  path (GitHub API vs. local `git merge --no-ff && push`), and no local
  build-baseline gate. **This daemon does not replace or coordinate with
  it.** Running both against the same repo at once is a real
  double-merge race risk (nothing here checks whether the bridge already
  merged the same PR moments earlier) — until they're unified or one is
  retired, treat Telegram and SMS as mutually exclusive approval channels,
  or serialize them manually.
- This daemon was implemented and type-checked but **could not be run
  end-to-end** in the environment it was built in (no live Firestore
  listener, no real Telegram bot, no `wugi-prod` deploy credentials
  exercised) — see "What's untested" below.

## Install

```sh
cd scripts/approval-executor
npm install
npm run build
```

Seed the Firestore baselines doc once (uses whatever service account
`GOOGLE_APPLICATION_CREDENTIALS` / `mobile-app/scripts/serviceAccount.json`
resolves to — see `src/serviceAccount.ts`):

```sh
npm run seed-baselines
```

Copy the plist and fill in the placeholders (**never commit real tokens**
— verify with `git check-ignore` before adding any credential file, and
never edit `launchd/us.wugi.approvals.plist` in place with real secrets):

```sh
cp launchd/us.wugi.approvals.plist ~/Library/LaunchAgents/us.wugi.approvals.plist
# edit ~/Library/LaunchAgents/us.wugi.approvals.plist: WorkingDirectory,
# WUGI_APPROVALS_HOSTNAME (must equal `hostname`'s output on this machine),
# and the GITHUB_TOKEN / TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID / ASANA_PAT values.
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/us.wugi.approvals.plist
```

## Kickstart / restart

```sh
launchctl kickstart -k gui/$(id -u)/us.wugi.approvals
```

## Logs

`StandardOutPath` / `StandardErrorPath` in the plist point at
`logs/approval-executor.log` / `logs/approval-executor.error.log` under
the repo root (already gitignored — see root `.gitignore`'s `logs/`
entry). Update the paths in the plist if the Air's checkout lives
somewhere else.

## Dry run

Runs the full pre-push gate for one entry and logs what it would do,
without claiming the entry or merging/deploying anything:

```sh
node lib/daemon.js --dry-run <entryId>
```

## Required environment variables

| Var | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | GitHub REST API reads (PR state, mergeability, changed files) |
| `TELEGRAM_BOT_TOKEN` | `@WugiPMBot` Bot API token, for receipts/failures |
| `TELEGRAM_CHAT_ID` | chat to post to |
| `ASANA_PAT` | posts the completion comment on the linked Asana task, if any |
| `WUGI_APPROVALS_HOSTNAME` | must equal this machine's `hostname` output — hard refusal otherwise |
| `GOOGLE_APPLICATION_CREDENTIALS` (optional) | overrides the `serviceAccount.json` lookup — see `src/serviceAccount.ts` |

## Behavior summary

- Firestore `onSnapshot` listener on `system/pendingApprovals`, plus an
  unconditional 60s poll (`src/listener.ts`) that also covers the gap
  between a listener drop and its reconnect (exponential backoff, capped
  at 60s).
- Entries with `status: 'pending'` and `verb` in `MERGE` / `DEPLOY` /
  `HOLD` are claimed atomically via a Firestore transaction
  (`src/claim.ts`) before anything else touches them.
- Hostname guard (`src/config.ts#assertRunningOnApprovedHost`) refuses to
  start anywhere but the configured `WUGI_APPROVALS_HOSTNAME`.
- Pre-push gate (`src/gate.ts`, `src/gateChecks/`): PR open + mergeable,
  head SHA matches the entry's `reviewedSha`, file-overlap against other
  open PRs, and a fresh-`git worktree` build-baseline check
  (`npm run build` in `functions/`, `npx tsc --noEmit` in `mobile-app/`,
  whichever the diff touches) against `system/buildBaselines`. All four
  block execution on failure. `DEPLOY` runs the same gate **minus the PR
  open/mergeable and SHA checks** — those only make sense for a PR that
  hasn't merged yet, and DEPLOY always follows a MERGE. The denylist scan
  (`firestore.rules`, `storage.rules`, `functions/src/bridge/**`,
  `functions/src/stripe/**`, `functions/src/terminal/**`, any
  `package.json`) never blocks — a hit still executes on Jarrod's word,
  but the result message says `DENYLIST` explicitly.
- `MERGE`: `git checkout main && git pull && git merge --no-ff
  origin/<branch> -m "Merge PR #n: <title> (approved via Telegram)" && git
  push`. Does not deploy — the separate auto-deploy daemon (untouched by
  this task) handles function/dashboard deploys from `main`.
- `DEPLOY n`: `firebase deploy --only functions:<names> --project
  wugi-prod`, function names read from the approval entry.
- `HOLD n`: marks the entry `held`, posts a Telegram ack, nothing else.
- On success: `status: 'executed'` with a result note (merge SHA / deploy
  output tail), Telegram receipt, and an Asana comment if the entry
  carries an `asanaGid`.
- On gate failure: `status: 'failed'` with the specific reason, entry
  stays re-sendable (a producer can flip it back to `pending`), Telegram
  message names the exact failing check. Never a partial merge — the gate
  runs fully before any git/firebase mutation.
- `src/execute.ts#executeApproval` is exported standalone specifically so
  a future night-merge daemon can call it with `source: 'night'` instead
  of `'telegram'` — no night-mode branching exists in this task's scope.

## What's untested

Built and type-checked in an environment with no live Firestore project,
no real Telegram bot, no `wugi-prod` deploy credentials exercised, and no
open PRs on `jarrodknight88/wugi` to gate against. Before trusting this
against production:

- Run `--dry-run` against a real pending entry once the Telegram producer
  side exists and writes to `system/pendingApprovals`.
- Confirm the `git worktree add ... origin/<branch>` step actually has
  that ref locally (it assumes `git fetch` has already run / the daemon's
  checkout has an up-to-date `origin` remote).
- Confirm `firebase` and `gh`-equivalent auth (a `GITHUB_TOKEN` with
  `repo` scope) are both available in the launchd environment — launchd
  does not inherit a login shell's env or `~/.npmrc`/`~/.netrc` state.
- **There is no Telegram bot in this repo that writes `MERGE`/`DEPLOY`/
  `HOLD` entries to `system/pendingApprovals`.** This package is the
  consumer only; the producer (the `@WugiPMBot` side that turns a Telegram
  reply into a Firestore write) is out of scope here and needs to exist
  before this daemon has anything to do.

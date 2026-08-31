// ─────────────────────────────────────────────────────────────────────
// Wugi — Approval Executor config: env vars, constants, hostname guard.
//
// Secrets required (never commit or print these — verify with
// `git check-ignore` before adding any new credential file):
//   GITHUB_TOKEN       — GitHub REST API (PR/files reads only; the actual
//                         merge is a local `git push`, not the GitHub API).
//   TELEGRAM_BOT_TOKEN — @WugiPMBot Bot API token.
//   TELEGRAM_CHAT_ID   — chat to post receipts/failures to.
//   ASANA_PAT          — Asana personal access token, for the completion comment.
//   WUGI_APPROVALS_HOSTNAME — the Air's hostname; execution refuses to run elsewhere.
// None of these existed in-repo before this daemon (see README "Design notes").
// ─────────────────────────────────────────────────────────────────────

import * as os from 'node:os';
import * as path from 'node:path';

export const GITHUB_OWNER = 'jarrodknight88';
export const GITHUB_REPO = 'wugi';

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** system/pendingApprovals — see types.ts for the doc shape. */
export const PENDING_APPROVALS_DOC = 'system/pendingApprovals';
/** system/buildBaselines — see types.ts BuildBaselines. */
export const BUILD_BASELINES_DOC = 'system/buildBaselines';

export const POLL_FALLBACK_MS = 60_000;
export const RECONNECT_BACKOFF_BASE_MS = 1_000;
export const RECONNECT_BACKOFF_MAX_MS = 60_000;

/** Paths that always trip the (non-blocking) denylist flag on a diff. */
export const DENYLIST_PATTERNS: RegExp[] = [
  /(^|\/)firestore\.rules$/,
  /(^|\/)storage\.rules$/,
  /(^|\/)functions\/src\/bridge\//,
  /(^|\/)functions\/src\/stripe\//,
  /(^|\/)functions\/src\/terminal\//,
  /(^|\/)package\.json$/,
];

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/** Refuse to run anywhere but the Air. Set WUGI_APPROVALS_HOSTNAME to the
 * expected `hostname` output on that machine. */
export function assertRunningOnApprovedHost(): void {
  const expected = process.env.WUGI_APPROVALS_HOSTNAME;
  if (!expected) throw new Error('Missing required env var: WUGI_APPROVALS_HOSTNAME');
  const actual = os.hostname();
  if (actual !== expected) {
    throw new Error(
      `Hostname guard failed: running on '${actual}', expected '${expected}'. Refusing to start.`
    );
  }
}

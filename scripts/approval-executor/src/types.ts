// ─────────────────────────────────────────────────────────────────────
// Wugi — Approval Executor (us.wugi.approvals) shared types
//
// No prior art for this shape exists in the repo (see README "Design
// notes"): system/pendingApprovals is a single Firestore doc whose
// top-level fields are entryId -> ApprovalEntry, mirroring the existing
// bridge's system/bridgePrLinks / system/bridgeDispatches convention
// (functions/src/bridge/shared.ts) rather than a growing collection.
// ─────────────────────────────────────────────────────────────────────

export type ApprovalVerb = 'MERGE' | 'DEPLOY' | 'HOLD';

export type ApprovalStatus = 'pending' | 'claimed' | 'executed' | 'failed' | 'held';

export type ExecutionSource = 'telegram' | 'night';

/** One entry under the system/pendingApprovals doc, keyed by entryId. */
export interface ApprovalEntry {
  verb: ApprovalVerb;
  /** PR number — required for MERGE, and for DEPLOY when the deploy is tied to a reviewed PR. */
  prNumber?: number;
  /** SHA the PM reviewed at approval time (written by the PM run). Required for MERGE. */
  reviewedSha?: string;
  /** Cloud Function names to deploy — required for DEPLOY. */
  functionNames?: string[];
  /** Linked Asana task GID, if any — receipt gets posted here on completion. */
  asanaGid?: string;
  status: ApprovalStatus;
  /** Hostname that claimed this entry, set by the claim transaction. */
  claimedBy?: string;
  /** Claim timestamp, epoch ms, set by the claim transaction. */
  claimedAtMs?: number;
  /** Where this entry originated — Telegram today; the night-merge daemon passes 'night'. */
  source?: ExecutionSource;
  /** Result note set on completion: merge SHA, deploy output tail, or failure reason. */
  result?: string;
  /** Epoch ms the entry was written by the producer (Telegram bot / PM run). */
  createdAtMs?: number;
}

export interface PendingApprovalsDoc {
  [entryId: string]: ApprovalEntry;
}

/** system/buildBaselines — per-package tsc/build error counts a gate run must not exceed.
 * Canonical numbers live in the root CLAUDE.md TypeScript baselines table; keep this doc
 * in sync with it manually (see README). */
export interface BuildBaselines {
  functions: number;
  mobileApp: number;
}

export interface GitHubPullRequest {
  number: number;
  state: 'open' | 'closed';
  merged: boolean;
  mergeable: boolean | null;
  title: string;
  body: string | null;
  head: { sha: string; ref: string };
  html_url: string;
}

export interface CheckResult {
  pass: boolean;
  reason: string;
}

export interface BaselineCounts {
  functions: number | null;
  mobileApp: number | null;
}

export interface DenylistResult {
  hit: boolean;
  matches: string[];
}

export interface OverlapResult {
  overlap: boolean;
  withPrs: number[];
}

export interface GateResult {
  /** True only if every blocking check passed. Denylist hits never block — see README. */
  pass: boolean;
  /** The PR's head ref and title, resolved by the gate in 'merge' mode — what MERGE actually merges. */
  headRef?: string;
  prTitle?: string;
  prCheck?: CheckResult;
  shaCheck?: CheckResult;
  baselineCheck?: CheckResult & { counts: BaselineCounts };
  overlapCheck?: CheckResult & OverlapResult;
  denylist: DenylistResult;
  /** First blocking failure's reason, suitable for the Telegram gate-failure message. */
  failureReason?: string;
}

export interface ExecuteResult {
  status: 'executed' | 'failed' | 'held';
  message: string;
  gate?: GateResult;
}

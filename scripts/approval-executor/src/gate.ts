// ─────────────────────────────────────────────────────────────────────
// Pre-push gate orchestrator. See README "Design notes" for why DEPLOY
// runs "the same gate minus PR checks": prCheck/shaCheck only make sense
// for an open, not-yet-merged PR, so DEPLOY (which always follows a
// MERGE) skips them but still runs denylist/overlap/baseline against the
// PR's file list and a fresh build of `main`.
// ─────────────────────────────────────────────────────────────────────

import { getBuildBaselines } from './baselinesDoc';
import { checkBaselineRegression } from './gateChecks/baseline';
import { scanDenylist } from './gateChecks/denylist';
import { checkFileOverlap } from './gateChecks/overlap';
import { checkPrOpenAndMergeable } from './gateChecks/prCheck';
import { checkShaMatch } from './gateChecks/shaCheck';
import { getPullRequest, listOtherOpenPullRequests, listPullRequestFiles } from './github';
import { measureBuildBaselines } from './worktree';
import type { ApprovalEntry, GateResult } from './types';

export async function runPrePushGate(
  entry: ApprovalEntry,
  mode: 'merge' | 'deploy',
  ghToken: string
): Promise<GateResult> {
  if (!entry.prNumber) {
    return {
      pass: false,
      denylist: { hit: false, matches: [] },
      failureReason: 'Approval entry has no prNumber',
    };
  }

  const pr = await getPullRequest(entry.prNumber, ghToken);
  const result: GateResult = { pass: true, denylist: { hit: false, matches: [] } };

  let branch = 'main';
  if (mode === 'merge') {
    result.prCheck = checkPrOpenAndMergeable(pr);
    if (!result.prCheck.pass) {
      result.pass = false;
      result.failureReason = result.prCheck.reason;
      return result;
    }
    result.shaCheck = checkShaMatch(entry.reviewedSha, pr!.head.sha);
    if (!result.shaCheck.pass) {
      result.pass = false;
      result.failureReason = result.shaCheck.reason;
      return result;
    }
    branch = pr!.head.ref;
    result.headRef = pr!.head.ref;
    result.prTitle = pr!.title;
  }

  if (!pr) {
    return {
      pass: false,
      denylist: { hit: false, matches: [] },
      failureReason: `PR #${entry.prNumber} not found — cannot resolve its diff for the deploy gate`,
    };
  }

  const changedFiles = await listPullRequestFiles(entry.prNumber, ghToken);
  result.denylist = scanDenylist(changedFiles);

  const otherPrNumbers = await listOtherOpenPullRequests(entry.prNumber, ghToken);
  const otherPrFiles: Record<number, string[]> = {};
  for (const n of otherPrNumbers) {
    otherPrFiles[n] = await listPullRequestFiles(n, ghToken);
  }
  const overlap = checkFileOverlap(changedFiles, otherPrFiles);
  result.overlapCheck = {
    pass: !overlap.overlap,
    reason: overlap.overlap
      ? `Touches files also in flight on PR(s) ${overlap.withPrs.join(', ')}`
      : 'No file overlap with other open PRs',
    ...overlap,
  };
  if (!result.overlapCheck.pass) {
    result.pass = false;
    result.failureReason = result.overlapCheck.reason;
    return result;
  }

  const baselines = await getBuildBaselines();
  const counts = await measureBuildBaselines(branch, changedFiles);
  const baselineCheck = checkBaselineRegression(counts, baselines);
  result.baselineCheck = { ...baselineCheck, counts };
  if (!baselineCheck.pass) {
    result.pass = false;
    result.failureReason = baselineCheck.reason;
    return result;
  }

  return result;
}

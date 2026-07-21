// ─────────────────────────────────────────────────────────────────────
// Wugi — Asana ⇄ GitHub bridge: shared helpers
//
// Used by asanaWebhook (Asana → GitHub issue dispatch) and githubWebhook
// (GitHub activity → Asana comment + SMS). Node built-ins only — no SDKs.
// ─────────────────────────────────────────────────────────────────────

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

// ── Constants ────────────────────────────────────────────────────────

export const ASANA_WORKSPACE_GID = '1208137481227174';
export const DEV_AGENT_EMAIL = 'developer.jarrod@gmail.com';
export const GITHUB_OWNER = 'jarrodknight88';
export const GITHUB_REPO = 'wugi';
export const JARROD_PHONE = '+14704229247';

/** Firestore doc holding Asana X-Hook-Secret values, one field per webhook. */
export const SECRETS_DOC = 'system/asanaWebhookSecrets';
/** Firestore doc holding dispatch records, one field per Asana task GID. */
export const DISPATCHES_DOC = 'system/bridgeDispatches';
/** Firestore doc holding PR ⇄ Asana-task links, one field per PR number (string key). */
export const PR_LINKS_DOC = 'system/bridgePrLinks';
/** Firestore doc holding the SMS inbound rate-limit window (single field: timestamps). */
export const SMS_RATE_LIMIT_DOC = 'system/bridgeSmsRateLimit';
/** Firestore doc holding a pending "MERGE ALL" confirmation, if any. */
export const MERGE_ALL_PENDING_DOC = 'system/bridgeMergeAllPending';

const ASANA_API = 'https://app.asana.com/api/1.0';
const GITHUB_API = 'https://api.github.com';

/** Marker line embedded in bridge-created issue bodies. */
const ASANA_GID_MARKER = /^Asana-GID:\s*(\d+)\s*$/m;

// ── Types ────────────────────────────────────────────────────────────

export interface AsanaTask {
  gid: string;
  name: string;
  notes: string;
  html_notes?: string;
  completed: boolean;
  permalink_url: string;
  assignee?: { gid: string; name?: string } | null;
  projects: Array<{ gid: string; name: string }>;
}

export interface DispatchRecord {
  status: 'pending' | 'dispatched';
  taskName?: string;
  issueNumber?: number;
  issueUrl?: string;
  firstReplySmsSent?: boolean;
  /** Issue number whose Claude final-report comment has already been relayed to Asana. */
  finalReportRelayedIssue?: number;
}

export interface AsanaStory {
  gid: string;
  text: string;
  resource_subtype: string;
  created_by?: { gid: string; name?: string } | null;
  created_at?: string;
}

/** A PR ⇄ Asana-task link, keyed by PR number. Populated when a "PM CODE
 * REVIEW" verdict lands on the task; consulted (and re-verified against
 * live Asana data) when a MERGE/HOLD SMS command references the PR. */
export interface PrLinkRecord {
  taskGid: string;
  issueNumber?: number;
  /** Cached verdict from the most recent PM CODE REVIEW comment — a
   * convenience for STATUS/MERGE-ALL prompts. MERGE always re-verifies
   * against Asana directly rather than trusting this field alone. */
  verdict?: 'APPROVE' | 'REWORK' | 'HOLD' | null;
  /** Set by the HOLD SMS command; blocks MERGE until a fresh PM CODE
   * REVIEW verdict is posted (which clears it). */
  held?: boolean;
}

// ── Asana API (fetch, no SDK) ────────────────────────────────────────

async function asanaRequest(
  path: string,
  token: string,
  init?: { method?: string; body?: unknown }
): Promise<any> {
  const res = await fetch(`${ASANA_API}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Asana ${init?.method ?? 'GET'} ${path} failed [${res.status}]: ${body}`);
  }
  const json = await res.json();
  return json.data;
}

export async function fetchAsanaTask(taskGid: string, token: string): Promise<AsanaTask> {
  return (await asanaRequest(
    `/tasks/${taskGid}?opt_fields=gid,name,notes,html_notes,completed,permalink_url,assignee,projects.name`,
    token
  )) as AsanaTask;
}

export async function postAsanaComment(
  taskGid: string,
  text: string,
  token: string
): Promise<void> {
  await asanaRequest(`/tasks/${taskGid}/stories`, token, {
    method: 'POST',
    body: { data: { text } },
  });
}

/**
 * Resolve an Asana user GID by email. Asana's /users/{user_gid} endpoint
 * accepts an email address as the identifier.
 */
export async function resolveAsanaUserGid(email: string, token: string): Promise<string> {
  const user = await asanaRequest(
    `/users/${encodeURIComponent(email)}?opt_fields=gid,email&workspace=${ASANA_WORKSPACE_GID}`,
    token
  );
  if (!user?.gid) throw new Error(`Asana user not found for ${email}`);
  return user.gid as string;
}

/** Resolve the Asana user GID that owns the given PAT. */
export async function fetchAsanaCurrentUserGid(token: string): Promise<string> {
  const user = await asanaRequest('/users/me?opt_fields=gid', token);
  return user.gid as string;
}

export async function fetchAsanaStory(storyGid: string, token: string): Promise<AsanaStory> {
  return (await asanaRequest(
    `/stories/${storyGid}?opt_fields=text,resource_subtype,created_by.name`,
    token
  )) as AsanaStory;
}

/** All comment stories on a task, oldest first (Asana's default order). */
export async function fetchAsanaTaskStories(taskGid: string, token: string): Promise<AsanaStory[]> {
  const stories = (await asanaRequest(
    `/tasks/${taskGid}/stories?opt_fields=text,resource_subtype,created_by.name,created_at`,
    token
  )) as AsanaStory[];
  return stories ?? [];
}

// ── GitHub API (fetch, no SDK) ───────────────────────────────────────

export class GithubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'GithubApiError';
  }
}

async function githubRequest(
  path: string,
  token: string,
  init?: { method?: string; body?: unknown }
): Promise<any> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'wugi-bridge',
      'Content-Type': 'application/json',
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new GithubApiError(
      res.status,
      `GitHub ${init?.method ?? 'GET'} ${path} failed [${res.status}]: ${body}`
    );
  }
  return res.json();
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Dispatch's GitHub issue creation gets 3 total attempts (1s, 2s backoff) on 5xx. */
const CREATE_ISSUE_MAX_ATTEMPTS = 3;

export async function createGithubIssue(
  title: string,
  body: string,
  token: string
): Promise<{ number: number; html_url: string }> {
  for (let attempt = 1; ; attempt++) {
    try {
      const issue = await githubRequest(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`, token, {
        method: 'POST',
        body: { title, body },
      });
      return { number: issue.number, html_url: issue.html_url };
    } catch (err) {
      const is5xx = err instanceof GithubApiError && err.status >= 500;
      if (!is5xx || attempt >= CREATE_ISSUE_MAX_ATTEMPTS) throw err;
      const backoffMs = 2 ** (attempt - 1) * 1000; // 1s, then 2s
      logger.warn('createGithubIssue got a 5xx — retrying', { attempt, backoffMs, err: String(err) });
      await delay(backoffMs);
    }
  }
}

export async function getGithubIssue(
  issueNumber: number,
  token: string
): Promise<{ number: number; state: string; title: string; body: string | null } | null> {
  try {
    const issue = await githubRequest(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}`,
      token
    );
    return { number: issue.number, state: issue.state, title: issue.title, body: issue.body };
  } catch (err) {
    logger.warn('getGithubIssue failed', { issueNumber, err: String(err) });
    return null;
  }
}

export async function getGithubComment(
  commentId: number,
  token: string
): Promise<{ id: number; body: string; html_url: string } | null> {
  try {
    const comment = await githubRequest(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/comments/${commentId}`,
      token
    );
    return { id: comment.id, body: comment.body, html_url: comment.html_url };
  } catch (err) {
    logger.warn('getGithubComment failed', { commentId, err: String(err) });
    return null;
  }
}

export async function postGithubComment(
  issueNumber: number,
  body: string,
  token: string
): Promise<void> {
  await githubRequest(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}/comments`, token, {
    method: 'POST',
    body: { body },
  });
}

export interface GithubPullRequest {
  number: number;
  state: string;
  merged: boolean;
  mergeable: boolean | null;
  title: string;
  body: string | null;
  html_url: string;
}

export async function getGithubPullRequest(
  prNumber: number,
  token: string
): Promise<GithubPullRequest | null> {
  try {
    const pr = await githubRequest(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls/${prNumber}`, token);
    return {
      number: pr.number,
      state: pr.state,
      merged: pr.merged === true,
      mergeable: pr.mergeable ?? null,
      title: pr.title,
      body: pr.body,
      html_url: pr.html_url,
    };
  } catch (err) {
    logger.warn('getGithubPullRequest failed', { prNumber, err: String(err) });
    return null;
  }
}

export async function squashMergeGithubPullRequest(
  prNumber: number,
  commitTitle: string,
  token: string
): Promise<{ merged: boolean; message: string }> {
  try {
    const result = await githubRequest(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls/${prNumber}/merge`,
      token,
      { method: 'PUT', body: { merge_method: 'squash', commit_title: commitTitle } }
    );
    return { merged: result.merged === true, message: result.message ?? 'merged' };
  } catch (err) {
    const message =
      err instanceof GithubApiError ? err.message : `GitHub merge request failed: ${String(err)}`;
    logger.error('squashMergeGithubPullRequest failed', { prNumber, err: message });
    return { merged: false, message };
  }
}

/**
 * Resolve the Asana task GID a PR was dispatched from: the `Asana-GID:`
 * marker in the PR body, else the marker on an issue the PR references
 * (e.g. "Fixes #12"). Shared by the GitHub-webhook PR relay and the
 * Twilio MERGE/HOLD command path so both resolve a PR the same way.
 */
export async function resolveTaskGidForPr(
  pr: { body?: string | null; title?: string | null },
  ghToken: string
): Promise<string | null> {
  const direct = extractAsanaGid(pr.body ?? '');
  if (direct) return direct;
  const ref = `${pr.title ?? ''}\n${pr.body ?? ''}`.match(/#(\d+)/);
  if (!ref) return null;
  const issue = await getGithubIssue(Number(ref[1]), ghToken);
  return issue ? extractAsanaGid(issue.body ?? '') : null;
}

// ── Twilio SMS (REST via fetch, no SDK) ──────────────────────────────

/** E.164: leading +, then 8-15 digits, first digit 1-9. */
const E164_REGEX = /^\+[1-9]\d{7,14}$/;

export interface SendSmsResult {
  ok: boolean;
  sid?: string;
  status?: string;
  errorCode?: number;
  errorMessage?: string;
}

/**
 * Send an SMS via the Twilio REST API and log the outcome explicitly —
 * every call site funnels through here so a single fix covers the whole
 * bridge. Twilio's POST only confirms the message was *accepted for
 * queueing* (HTTP 201); it does not confirm delivery. We log the sid +
 * initial status either way so a queued-but-never-delivered message
 * (e.g. rejected async for an unapproved A2P 10DLC campaign — see
 * AGENTS.md "Twilio A2P 10DLC pending Brand/Campaign approval") is at
 * least visible in Cloud Logging instead of vanishing silently.
 */
export async function sendSms(
  to: string,
  body: string,
  accountSid: string,
  authToken: string,
  fromNumber: string
): Promise<SendSmsResult> {
  if (!E164_REGEX.test(to) || !E164_REGEX.test(fromNumber)) {
    logger.error('Twilio SMS aborted — malformed E.164 number', { to, fromNumber });
    return { ok: false, errorMessage: `Malformed E.164 number: to=${to} from=${fromNumber}` };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: fromNumber, Body: body });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
  } catch (err) {
    // Network-level failure — fetch() throws instead of resolving with !ok.
    logger.error('Twilio SMS request threw (network error)', { to, err: String(err) });
    return { ok: false, errorMessage: `Twilio request failed: ${String(err)}` };
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // Body wasn't JSON — fall through, res.ok / status still drive the result.
  }

  if (!res.ok) {
    logger.error('Twilio SMS rejected by API', {
      to,
      status: res.status,
      twilioErrorCode: json?.code,
      twilioErrorMessage: json?.message,
      moreInfo: json?.more_info,
    });
    return {
      ok: false,
      errorCode: json?.code,
      errorMessage: json?.message ?? `Twilio API returned ${res.status}`,
    };
  }

  logger.info('Twilio SMS queued', { to, sid: json?.sid, status: json?.status });
  return { ok: true, sid: json?.sid, status: json?.status };
}

// ── Dispatch records (Firestore) ─────────────────────────────────────

export async function getDispatchRecord(taskGid: string): Promise<DispatchRecord | null> {
  const snap = await admin.firestore().doc(DISPATCHES_DOC).get();
  const record = (snap.data() ?? {})[taskGid];
  return (record as DispatchRecord) ?? null;
}

export async function setDispatchRecord(
  taskGid: string,
  record: Partial<DispatchRecord> & Record<string, unknown>
): Promise<void> {
  await admin.firestore().doc(DISPATCHES_DOC).set({ [taskGid]: record }, { merge: true });
}

export async function deleteDispatchRecord(taskGid: string): Promise<void> {
  await admin.firestore().doc(DISPATCHES_DOC).update({
    [taskGid]: admin.firestore.FieldValue.delete(),
  });
}

// ── PR ⇄ Asana-task links (Firestore) ────────────────────────────────

export async function getPrLinkRecord(prNumber: number): Promise<PrLinkRecord | null> {
  const snap = await admin.firestore().doc(PR_LINKS_DOC).get();
  const record = (snap.data() ?? {})[String(prNumber)];
  return (record as PrLinkRecord) ?? null;
}

export async function setPrLinkRecord(
  prNumber: number,
  record: Partial<PrLinkRecord> & Record<string, unknown>
): Promise<void> {
  await admin.firestore().doc(PR_LINKS_DOC).set({ [String(prNumber)]: record }, { merge: true });
}

export async function listPrLinkRecords(): Promise<Array<[number, PrLinkRecord]>> {
  const snap = await admin.firestore().doc(PR_LINKS_DOC).get();
  const data = snap.data() ?? {};
  return Object.entries(data).map(([k, v]) => [Number(k), v as PrLinkRecord]);
}

// ── SMS command rate limit (Firestore, sliding 1h window) ────────────

const RATE_LIMIT_MAX_PER_HOUR = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** Atomically records this attempt and returns true if it's within the
 * 10-commands/hour budget (false = caller must refuse and stop). */
export async function claimSmsRateLimitSlot(nowMs: number): Promise<boolean> {
  const ref = admin.firestore().doc(SMS_RATE_LIMIT_DOC);
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = ((snap.data() ?? {}).timestamps ?? []) as number[];
    const recent = existing.filter((t) => nowMs - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX_PER_HOUR) {
      tx.set(ref, { timestamps: recent }, { merge: true });
      return false;
    }
    recent.push(nowMs);
    tx.set(ref, { timestamps: recent }, { merge: true });
    return true;
  });
}

// ── MERGE ALL confirmation (Firestore) ────────────────────────────────

export interface MergeAllPending {
  prNumbers: number[];
  expiresAtMs: number;
}

export async function getMergeAllPending(): Promise<MergeAllPending | null> {
  const snap = await admin.firestore().doc(MERGE_ALL_PENDING_DOC).get();
  const data = snap.data();
  return (data as MergeAllPending) ?? null;
}

export async function setMergeAllPending(pending: MergeAllPending | null): Promise<void> {
  if (pending === null) {
    await admin.firestore().doc(MERGE_ALL_PENDING_DOC).delete();
    return;
  }
  await admin.firestore().doc(MERGE_ALL_PENDING_DOC).set(pending);
}

// ── Misc ─────────────────────────────────────────────────────────────

/** Pull the `Asana-GID: <gid>` marker out of an issue/PR body. */
export function extractAsanaGid(body: string): string | null {
  const match = body.match(ASANA_GID_MARKER);
  return match ? match[1] : null;
}

export function truncate(text: string, max = 500): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

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

function delay(ms: number): Promise<void> {
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

// ── Twilio SMS (REST via fetch, no SDK) ──────────────────────────────

export async function sendSms(
  to: string,
  body: string,
  accountSid: string,
  authToken: string,
  fromNumber: string
): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: fromNumber, Body: body });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    // Non-fatal — SMS failure should never break the bridge
    logger.warn('Twilio SMS failed', { status: res.status, body: text });
  }
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

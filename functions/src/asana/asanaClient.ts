// ─────────────────────────────────────────────────────────────────────
// Wugi — Asana API Client
// Posts comments as the Dev Agent service account.
// ─────────────────────────────────────────────────────────────────────

import { AsanaTask } from './asanaWebhookTypes';

const ASANA_API_BASE = 'https://app.asana.com/api/1.0';

/**
 * Fetch full task details from Asana.
 */
export async function fetchTask(
  taskGid: string,
  token: string
): Promise<AsanaTask> {
  const url = `${ASANA_API_BASE}/tasks/${taskGid}?opt_fields=gid,name,notes,html_notes,completed,projects,memberships.project,memberships.section,assignee,due_on`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Asana fetchTask failed [${res.status}]: ${body}`);
  }
  const json = await res.json();
  return json.data as AsanaTask;
}

/**
 * Post a comment to an Asana task as the Dev Agent.
 */
export async function postTaskComment(
  taskGid: string,
  text: string,
  token: string
): Promise<void> {
  const url = `${ASANA_API_BASE}/tasks/${taskGid}/stories`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: { text } }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Asana postTaskComment failed [${res.status}]: ${body}`);
  }
}

/**
 * Fetch a single story (comment) by GID to get full details including author.
 */
export async function fetchStory(
  storyGid: string,
  token: string
): Promise<{ gid: string; text: string; created_by: { gid: string } }> {
  const url = `${ASANA_API_BASE}/stories/${storyGid}?opt_fields=gid,text,created_by`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Asana fetchStory failed [${res.status}]: ${body}`);
  }
  const json = await res.json();
  return json.data;
}

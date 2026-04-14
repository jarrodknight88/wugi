"use strict";
// ─────────────────────────────────────────────────────────────────────
// Wugi — Asana API Client
// Posts comments as the Dev Agent service account.
// ─────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchTask = fetchTask;
exports.postTaskComment = postTaskComment;
exports.fetchStory = fetchStory;
const ASANA_API_BASE = 'https://app.asana.com/api/1.0';
/**
 * Fetch full task details from Asana.
 */
async function fetchTask(taskGid, token) {
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
    return json.data;
}
/**
 * Post a comment to an Asana task as the Dev Agent.
 */
async function postTaskComment(taskGid, text, token) {
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
async function fetchStory(storyGid, token) {
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
//# sourceMappingURL=asanaClient.js.map
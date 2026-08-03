// ─────────────────────────────────────────────────────────────────────
// Wugi — Bridge v1.4: self-chaining dispatch queue
//
// When a dispatched task's Claude final-report is relayed (see
// githubWebhook.ts § handleIssueCommentEdited), this module pops the next
// eligible queued task and dispatches it — no PM session required.
//
// FIRESTORE SHAPE — system/dispatchQueue:
//   {
//     paused: boolean,
//     entries: [
//       { asanaTaskGid: string, lane: 'mobile-app'|'dashboard'|'functions'|'lens', note?: string },
//       ...
//     ]
//   }
//   `entries` is an ordered array — index 0 is next up, but the popper may
//   skip past entries whose lane collides with an in-flight dispatch (see
//   findEligibleEntryIndex below). Seed/edit this doc by hand in the
//   Firebase console or via the Firestore Admin SDK; there is no UI for it.
//
// bridgeDispatches (system/bridgeDispatches, see shared.ts) records gain
// two fields from this module:
//   - lane: DispatchLane — best-effort attached after a queue-triggered
//     dispatch lands (see attachLaneToNewDispatch). Manual dispatches (a
//     human flipping the Asana assignee directly) never get a lane and
//     default to 'unknown', which collides with every lane below.
//   - keyboardDone: boolean — set by githubWebhook.ts the moment a
//     dispatch's final report is relayed; this is this module's signal
//     that the dispatch no longer counts as in-flight.
//
// PURE LOGIC (getInFlightCap, findEligibleEntryIndex, selectQueueAction) is
// exercised by scripts/test-dispatch-queue.js — see that file for the spec.
// This repo has no test framework (see package.json), so — consistent with
// commandGrammar.ts / test-inbound-grammar.js — the Firestore/Asana/GitHub
// glue below is deliberately kept thin and untested at that layer, with all
// branching logic factored into the pure functions instead.
// ─────────────────────────────────────────────────────────────────────

import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

import {
  DEV_AGENT_EMAIL,
  DISPATCHES_DOC,
  DISPATCH_QUEUE_DOC,
  DispatchRecord,
  Lane,
  DispatchLane,
  delay,
  getDispatchRecord,
  setDispatchRecord,
  getGithubIssue,
  postAsanaComment,
  resolveAsanaUserGid,
  setAsanaAssignee,
} from './shared';

/** War-room Asana task — ops alerts land here when the chain step can't complete. */
const WAR_ROOM_TASK_GID = '1216691172432935';

const ET_TIME_ZONE = 'America/New_York';
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 22;
const DAY_CAP = 4;
const NIGHT_CAP = 8;

/** How long (and how many times) to poll for asanaWebhook's own dispatch
 * record to land before giving up on attaching a lane to it. Bounded well
 * under githubWebhook's 120s function timeout, most of which is already
 * spent on the final-report relay's own settle delay. */
const LANE_ATTACH_MAX_ATTEMPTS = 4;
const LANE_ATTACH_RETRY_DELAY_MS = 2_000;

// ── Types ────────────────────────────────────────────────────────────

export interface QueueEntry {
  asanaTaskGid: string;
  lane: Lane;
  note?: string;
}

export interface DispatchQueueDoc {
  paused: boolean;
  entries: QueueEntry[];
}

export type QueueAction =
  | {
      type: 'pop';
      index: number;
      entry: QueueEntry;
      /** 1-indexed position the entry held in `entries` before removal. */
      position: number;
      remainingEntries: QueueEntry[];
    }
  | { type: 'skip'; reason: 'paused' | 'empty' | 'at-cap' | 'no-eligible-lane' };

// ── Pure logic ───────────────────────────────────────────────────────

function getEasternHour(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIME_ZONE,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
  // Some ICU builds render midnight as "24" under hour12:false.
  return Number(hourStr) % 24;
}

/** In-flight dispatch cap: 4 during ET business hours (08:00–22:00), 8
 * overnight. DST-aware — resolved via Intl's America/New_York conversion
 * rather than a fixed UTC offset. */
export function getInFlightCap(now: Date): number {
  const hour = getEasternHour(now);
  return hour >= DAY_START_HOUR && hour < DAY_END_HOUR ? DAY_CAP : NIGHT_CAP;
}

/** 'unknown' is a conservative wildcard: a queue entry or in-flight
 * dispatch with an unknown lane is treated as colliding with everything. */
function lanesCollide(a: DispatchLane, b: DispatchLane): boolean {
  return a === b || a === 'unknown' || b === 'unknown';
}

/** First queue entry whose lane doesn't collide with any currently
 * in-flight lane, or -1 if none is eligible. */
export function findEligibleEntryIndex(entries: QueueEntry[], inFlightLanes: DispatchLane[]): number {
  return entries.findIndex((entry) => !inFlightLanes.some((lane) => lanesCollide(entry.lane, lane)));
}

/**
 * Decide what the chain step should do, given the queue doc, the lanes
 * currently in flight, and the cap for right now. Pure — no I/O — so the
 * transaction wrapper below just applies whatever this returns.
 */
export function selectQueueAction(
  queue: DispatchQueueDoc,
  inFlightLanes: DispatchLane[],
  cap: number
): QueueAction {
  if (queue.paused) return { type: 'skip', reason: 'paused' };

  const entries = queue.entries ?? [];
  if (entries.length === 0) return { type: 'skip', reason: 'empty' };

  if (inFlightLanes.length >= cap) return { type: 'skip', reason: 'at-cap' };

  const index = findEligibleEntryIndex(entries, inFlightLanes);
  if (index === -1) return { type: 'skip', reason: 'no-eligible-lane' };

  const entry = entries[index];
  const remainingEntries = entries.slice(0, index).concat(entries.slice(index + 1));
  return { type: 'pop', index, entry, position: index + 1, remainingEntries };
}

// ── Firestore / GitHub glue ──────────────────────────────────────────

/** Lanes currently "in flight": dispatches that haven't been marked
 * keyboardDone and whose GitHub issue (if any) is still open. */
async function computeInFlightLanes(ghToken: string): Promise<DispatchLane[]> {
  const snap = await admin.firestore().doc(DISPATCHES_DOC).get();
  const records = (snap.data() ?? {}) as Record<string, DispatchRecord>;
  const lanes: DispatchLane[] = [];

  for (const record of Object.values(records)) {
    if (record.keyboardDone === true) continue;
    if (record.status === 'pending') {
      // Claimed but its GitHub issue may not exist yet — no way to check
      // "open", so it counts as in-flight with the conservative default.
      lanes.push(record.lane ?? 'unknown');
      continue;
    }
    if (!record.issueNumber) continue;
    const issue = await getGithubIssue(record.issueNumber, ghToken);
    if (issue?.state === 'open') lanes.push(record.lane ?? 'unknown');
  }

  return lanes;
}

/**
 * Atomically pop the next eligible queue entry, if any. Recomputes
 * everything (paused flag, in-flight lanes, cap, eligible index) fresh
 * inside the transaction body so Firestore's automatic retry-on-conflict
 * re-derives the right entry instead of acting on a stale index if a
 * concurrent chain step already popped one.
 */
async function popEligibleQueueEntry(ghToken: string): Promise<{ entry: QueueEntry; position: number } | null> {
  const db = admin.firestore();
  const queueRef = db.doc(DISPATCH_QUEUE_DOC);

  return db.runTransaction(async (tx) => {
    const queueSnap = await tx.get(queueRef);
    const queue = (queueSnap.data() as DispatchQueueDoc | undefined) ?? { paused: false, entries: [] };

    // Skip the GitHub round trips entirely when we're going to skip anyway.
    const inFlightLanes =
      queue.paused || !queue.entries?.length ? [] : await computeInFlightLanes(ghToken);
    const cap = getInFlightCap(new Date());
    const action = selectQueueAction(queue, inFlightLanes, cap);

    if (action.type === 'skip') {
      logger.info('Dispatch queue chain step — skipping', { reason: action.reason });
      return null;
    }

    tx.update(queueRef, { entries: action.remainingEntries });
    return { entry: action.entry, position: action.position };
  });
}

/**
 * Best-effort: wait for asanaWebhook's own dispatch-creation transaction to
 * land, then merge `lane` onto the resulting record. Writing lane any
 * earlier (before the record exists) would make claimDispatch's
 * existing-record guard in asanaWebhook.ts treat this task as already
 * claimed and silently swallow the real dispatch — asanaWebhook.ts is out
 * of scope to change, so this polls instead of pre-seeding. If the record
 * never lands in time, the dispatch still went through; it just defaults
 * to lane 'unknown', the same conservative fallback manual dispatches get.
 */
async function attachLaneToNewDispatch(taskGid: string, lane: Lane): Promise<void> {
  for (let attempt = 0; attempt < LANE_ATTACH_MAX_ATTEMPTS; attempt++) {
    const record = await getDispatchRecord(taskGid);
    if (record?.issueNumber) {
      await setDispatchRecord(taskGid, { lane });
      return;
    }
    await delay(LANE_ATTACH_RETRY_DELAY_MS);
  }
  logger.warn('Dispatch queue: gave up waiting to attach lane to new dispatch record', { taskGid, lane });
}

/**
 * Run the chain step: pop the next eligible queued task (if any) and
 * dispatch it by flipping its Asana assignee. Never throws — any failure
 * is logged and reported to the war-room task, and per spec a failed pop
 * is never retried in-process; the entry (if not already popped) waits
 * for the next trigger.
 */
export async function runDispatchChainStep(
  triggeringIssueNumber: number,
  ghToken: string,
  pat: string
): Promise<void> {
  try {
    const popped = await popEligibleQueueEntry(ghToken);
    if (!popped) return;

    const { entry, position } = popped;
    const assigneeGid = await resolveAsanaUserGid(DEV_AGENT_EMAIL, pat);
    await setAsanaAssignee(entry.asanaTaskGid, assigneeGid, pat);
    await postAsanaComment(
      entry.asanaTaskGid,
      `AUTO-DISPATCHED by bridge v1.4 (queue position ${position}, triggered by issue #${triggeringIssueNumber} completing)`,
      pat
    );

    await attachLaneToNewDispatch(entry.asanaTaskGid, entry.lane);
  } catch (err) {
    logger.error('Dispatch queue chain step failed', { triggeringIssueNumber, err: String(err) });
    await postAsanaComment(WAR_ROOM_TASK_GID, `QUEUE CHAIN FAILURE: ${String(err)}`, pat).catch((commentErr) =>
      logger.error('Failed to post queue-chain failure to war room', { err: String(commentErr) })
    );
  }
}

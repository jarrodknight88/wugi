// ─────────────────────────────────────────────────────────────────────
// Wugi — asanaWebhook Cloud Function
//
// Receives Asana webhook events. When a task comment contains '@WugiAI',
// calls Claude for a diagnosis and posts the response back as a Dev Agent
// comment. Sends a Twilio SMS to Jarrod on completion.
//
// SECRETS REQUIRED (Firebase Secret Manager):
//   ASANA_DEV_AGENT_TOKEN    — PAT for developer.jarrod@gmail.com
//   ASANA_WEBHOOK_SECRET     — set when registering the Asana webhook
//   CLAUDE_API_KEY           — from console.anthropic.com
//   TWILIO_ACCOUNT_SID       — Twilio account SID
//   TWILIO_AUTH_TOKEN        — Twilio auth token
//   TWILIO_PHONE_NUMBER      — Twilio sender number
// ─────────────────────────────────────────────────────────────────────

import * as functions from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

import { AsanaWebhookPayload } from './asanaWebhookTypes';
import { fetchTask, fetchStory, postTaskComment } from './asanaClient';
import { diagnoseWithClaude } from './claudeClient';

// ── Constants ────────────────────────────────────────────────────────

/** Dev Agent Asana user GID — NEVER process comments from this account */
const DEV_AGENT_GID = '1210281336537130';

/** Rate limit: one Claude call per task per 60 seconds */
const RATE_LIMIT_SECONDS = 60;

/** Jarrod's phone number for SMS alerts */
const JARROD_PHONE = '+14704229247';

// ── Twilio SMS helper ────────────────────────────────────────────────

async function sendSms(
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
    logger.warn('Twilio SMS failed', { status: res.status, body: text });
  }
}

// ── Webhook signature validation ─────────────────────────────────────

function validateSignature(
  rawBody: string,
  receivedHmac: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(receivedHmac, 'hex')
    );
  } catch {
    return false;
  }
}

// ── Rate limit check ─────────────────────────────────────────────────

async function isRateLimited(taskGid: string): Promise<boolean> {
  const db = admin.firestore();
  const ref = db.doc(`_asanaWebhookRateLimit/${taskGid}`);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const lastCall = snap.data()?.lastCallAt?.toDate() as Date | undefined;
  if (!lastCall) return false;
  const elapsedSeconds = (Date.now() - lastCall.getTime()) / 1000;
  return elapsedSeconds < RATE_LIMIT_SECONDS;
}

async function markRateLimitTimestamp(taskGid: string): Promise<void> {
  const db = admin.firestore();
  await db.doc(`_asanaWebhookRateLimit/${taskGid}`).set({
    lastCallAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ── Main Cloud Function ───────────────────────────────────────────────

export const asanaWebhook = functions.onRequest(
  {
    secrets: [
      'ASANA_DEV_AGENT_TOKEN',
      'CLAUDE_API_KEY',
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_PHONE_NUMBER',
    ],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    // ── Step 1: Asana handshake (first-time endpoint verification) ──
    const hookSecret = req.headers['x-hook-secret'];
    if (hookSecret) {
      logger.info('Asana webhook handshake received');
      res.set('X-Hook-Secret', hookSecret as string);
      res.status(200).send();
      return;
    }

    // ── Step 2: Validate webhook signature ──────────────────────────
    const receivedHmac = req.headers['x-hook-hmac-sha256'] as string | undefined;
    if (!receivedHmac) {
      logger.warn('Missing X-Hook-Hmac-SHA256 header');
      res.status(401).send('Unauthorized');
      return;
    }

    const rawBody = JSON.stringify(req.body);
    const webhookSecret = process.env.ASANA_WEBHOOK_SECRET ?? '';
    if (!validateSignature(rawBody, receivedHmac, webhookSecret)) {
      logger.warn('Invalid Asana webhook signature');
      res.status(401).send('Invalid signature');
      return;
    }

    // Acknowledge immediately — Asana requires a fast 200
    res.status(200).send();


    // ── Step 3: Parse and process events ────────────────────────────
    try {
      const payload = req.body as AsanaWebhookPayload;
      if (!payload.events || payload.events.length === 0) return;

      const devAgentToken = process.env.ASANA_DEV_AGENT_TOKEN ?? '';
      const claudeApiKey  = process.env.CLAUDE_API_KEY ?? '';
      const twilioSid     = process.env.TWILIO_ACCOUNT_SID ?? '';
      const twilioToken   = process.env.TWILIO_AUTH_TOKEN ?? '';
      const twilioFrom    = process.env.TWILIO_PHONE_NUMBER ?? '';

      for (const event of payload.events) {
        // Only care about story (comment) additions on tasks
        if (
          event.action !== 'added' ||
          event.resource?.resource_type !== 'story' ||
          event.parent?.resource_type !== 'task'
        ) {
          continue;
        }

        const storyGid = event.resource.gid;
        const taskGid  = event.parent.gid;

        logger.info('Processing story event', { storyGid, taskGid });

        // Fetch the full story to get author GID and comment text
        let story: { gid: string; text: string; created_by: { gid: string } };
        try {
          story = await fetchStory(storyGid, devAgentToken);
        } catch (err) {
          logger.error('Failed to fetch story', { storyGid, err });
          continue;
        }

        // Guard 1: ignore comments from the Dev Agent (infinite loop prevention)
        if (story.created_by?.gid === DEV_AGENT_GID) {
          logger.info('Ignoring Dev Agent comment', { storyGid });
          continue;
        }

        // Guard 2: only act on comments that contain '@WugiAI'
        const commentText = story.text ?? '';
        if (!commentText.includes('@WugiAI')) {
          continue;
        }

        logger.info('@WugiAI trigger detected', { taskGid, storyGid });

        // Guard 3: rate limit — max 1 Claude call per task per 60s
        if (await isRateLimited(taskGid)) {
          logger.info('Rate limited, skipping', { taskGid });
          continue;
        }
        await markRateLimitTimestamp(taskGid);

        // Fetch full task details for context
        let task;
        try {
          task = await fetchTask(taskGid, devAgentToken);
        } catch (err) {
          logger.error('Failed to fetch task', { taskGid, err });
          continue;
        }

        // Guard 4: only process tasks in the Wugi workspace
        // (workspace filtering is enforced at webhook registration level;
        //  this is a secondary defense — skip if projects array is empty)
        if (task.projects.length === 0) {
          logger.warn('Task has no projects, skipping', { taskGid });
          continue;
        }

        // Call Claude for diagnosis
        let diagnosis: string;
        try {
          diagnosis = await diagnoseWithClaude(task, commentText, claudeApiKey);
          logger.info('Claude diagnosis complete', { taskGid });
        } catch (err) {
          logger.error('Claude API failed', { taskGid, err });
          await postTaskComment(
            taskGid,
            '⚠️ @WugiAI encountered an error calling the Claude API. Check Cloud Function logs.',
            devAgentToken
          );
          continue;
        }

        // Post diagnosis back to the Asana task as Dev Agent
        const responseComment = `🤖 **@WugiAI Diagnosis**\n\n${diagnosis}`;
        try {
          await postTaskComment(taskGid, responseComment, devAgentToken);
          logger.info('Dev Agent comment posted', { taskGid });
        } catch (err) {
          logger.error('Failed to post Asana comment', { taskGid, err });
          continue;
        }

        // Send Twilio SMS to Jarrod
        try {
          await sendSms(
            JARROD_PHONE,
            `🤖 @WugiAI diagnosed "${task.name}". Check Asana.`,
            twilioSid,
            twilioToken,
            twilioFrom
          );
          logger.info('SMS sent to Jarrod', { taskGid });
        } catch (err) {
          // SMS failure is non-fatal — log and continue
          logger.warn('SMS send failed (non-fatal)', { taskGid, err });
        }
      } // end for-loop over events

    } catch (err) {
      logger.error('asanaWebhook unhandled error', { err });
      // res already sent 200 — just log the failure
    }
  }
);

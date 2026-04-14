// ─────────────────────────────────────────────────────────────────────
// Wugi — Claude API Client
// Calls claude-sonnet-4-20250514 for UAT diagnosis.
// ─────────────────────────────────────────────────────────────────────

import { AsanaTask } from './asanaWebhookTypes';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const SYSTEM_PROMPT = `You are a senior React Native / Firebase developer working on the Wugi platform — an Atlanta nightlife discovery and ticketing app built with Expo SDK 54, React Native, Firebase (wugi-prod), and Stripe. You are reviewing UAT feedback posted as Asana task comments. Respond with:
1. Root cause analysis
2. Exact file and line if identifiable
3. Proposed fix with code snippet
Be concise — this is a developer comment, not an essay. Format your response in plain text suitable for an Asana comment.`;

export interface ClaudeDiagnosis {
  response: string;
}

/**
 * Call Claude with task context + UAT feedback comment.
 * Returns the diagnosis as a plain-text string.
 */
export async function diagnoseWithClaude(
  task: AsanaTask,
  commentText: string,
  apiKey: string
): Promise<string> {
  const projectNames = task.memberships
    .map((m) => m.project?.name)
    .filter(Boolean)
    .join(', ');

  const sectionName = task.memberships
    .find((m) => m.section)
    ?.section?.name ?? 'Unknown';

  const userPrompt = `
ASANA TASK CONTEXT:
Task: ${task.name}
Project(s): ${projectNames}
Section: ${sectionName}
Due: ${task.due_on ?? 'not set'}
Description:
${task.notes ?? '(no description)'}

UAT FEEDBACK (comment that triggered this):
${commentText.replace('@WugiAI', '').trim()}
`.trim();

  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API failed [${res.status}]: ${body}`);
  }

  const json = await res.json();
  const text = json.content
    ?.filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('\n') ?? '';

  return text.trim();
}

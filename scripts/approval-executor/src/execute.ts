// ─────────────────────────────────────────────────────────────────────
// Core execute path — MERGE / DEPLOY / HOLD. Exported so the (separate,
// not-yet-built) night-merge daemon can call it directly with
// `source: 'night'` instead of going through the Telegram listener. No
// night-mode-specific branching lives here; `source` is only ever used
// to stamp the result note, per the issue's "no night-mode logic in this
// task" scope.
// ─────────────────────────────────────────────────────────────────────

import { setEntryResult } from './claim';
import { deployFunctions } from './firebaseDeploy';
import { runPrePushGate } from './gate';
import { mergeBranchIntoMain } from './gitOps';
import { postAsanaComment } from './asana';
import { sendTelegramMessage } from './telegram';
import type { ApprovalEntry, ExecuteResult, ExecutionSource, GateResult } from './types';

export interface ExecuteContext {
  ghToken: string;
  telegramBotToken: string;
  telegramChatId: string;
  asanaPat: string;
}

function gateFailureMessage(entry: ApprovalEntry, gate: GateResult): string {
  const denylistNote = gate.denylist.hit ? ' [DENYLIST]' : '';
  return `${entry.verb} ${entry.prNumber} FAILED gate${denylistNote}: ${gate.failureReason}`;
}

async function notify(entryId: string, entry: ApprovalEntry, ctx: ExecuteContext, message: string) {
  await sendTelegramMessage(message, ctx.telegramBotToken, ctx.telegramChatId).catch((err) => {
    console.error(`[${entryId}] Telegram notify failed:`, err);
  });
  if (entry.asanaGid) {
    await postAsanaComment(entry.asanaGid, message, ctx.asanaPat).catch((err) => {
      console.error(`[${entryId}] Asana comment failed:`, err);
    });
  }
}

export async function executeApproval(
  entryId: string,
  entry: ApprovalEntry,
  source: ExecutionSource,
  ctx: ExecuteContext
): Promise<ExecuteResult> {
  if (entry.verb === 'HOLD') {
    const message = `HOLD ${entry.prNumber ?? ''} acknowledged (source: ${source})`;
    await setEntryResult(entryId, 'held', message);
    await sendTelegramMessage(message, ctx.telegramBotToken, ctx.telegramChatId).catch((err) => {
      console.error(`[${entryId}] Telegram notify failed:`, err);
    });
    return { status: 'held', message };
  }

  const mode = entry.verb === 'MERGE' ? 'merge' : 'deploy';
  const gate = await runPrePushGate(entry, mode, ctx.ghToken);

  if (!gate.pass) {
    const message = gateFailureMessage(entry, gate);
    await setEntryResult(entryId, 'failed', gate.failureReason ?? 'gate failed');
    await notify(entryId, entry, ctx, message);
    return { status: 'failed', message, gate };
  }

  const denylistNote = gate.denylist.hit
    ? ` [DENYLIST: ${gate.denylist.matches.join(', ')}]`
    : '';

  if (entry.verb === 'MERGE') {
    const commitMessage = `Merge PR #${entry.prNumber}: ${gate.prTitle} (approved via Telegram)`;
    const mergedSha = await mergeBranchIntoMain(gate.headRef!, commitMessage);
    const message = `MERGE #${entry.prNumber} executed — ${mergedSha.slice(0, 12)}${denylistNote} (source: ${source})`;
    await setEntryResult(entryId, 'executed', message);
    await notify(entryId, entry, ctx, message);
    return { status: 'executed', message, gate };
  }

  // DEPLOY
  const outputTail = await deployFunctions(entry.functionNames ?? []);
  const message = `DEPLOY #${entry.prNumber} executed${denylistNote} (source: ${source})\n${outputTail}`;
  await setEntryResult(entryId, 'executed', message);
  await notify(entryId, entry, ctx, message);
  return { status: 'executed', message, gate };
}

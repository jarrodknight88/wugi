#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// Wugi Approval Executor (us.wugi.approvals) — entrypoint.
//
//   node lib/daemon.js                  resident daemon (listener + poll fallback)
//   node lib/daemon.js --once           process the current doc once and exit
//   node lib/daemon.js --dry-run <id>   run the gate for one entry, log, exit
//
// See README.md for install/launchctl/kickstart instructions.
// ─────────────────────────────────────────────────────────────────────

import { assertRunningOnApprovedHost, requireEnv } from './config';
import { dryRunEntry } from './dryRun';
import type { ExecuteContext } from './execute';
import { runOnce, startListener } from './listener';

function buildContext(): ExecuteContext {
  return {
    ghToken: requireEnv('GITHUB_TOKEN'),
    telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
    telegramChatId: requireEnv('TELEGRAM_CHAT_ID'),
    asanaPat: requireEnv('ASANA_PAT'),
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--dry-run') {
    const entryId = args[1];
    if (!entryId) throw new Error('Usage: daemon.js --dry-run <entryId>');
    await dryRunEntry(entryId, requireEnv('GITHUB_TOKEN'));
    return;
  }

  assertRunningOnApprovedHost();
  const ctx = buildContext();

  if (args[0] === '--once') {
    await runOnce(ctx);
    return;
  }

  console.log('us.wugi.approvals daemon starting');
  startListener(ctx);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

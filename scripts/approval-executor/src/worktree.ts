// ─────────────────────────────────────────────────────────────────────
// Fresh `git worktree` checkout of the branch under review, so the build
// baseline check runs against exactly what's on the branch without
// touching the daemon's own working copy. Always removed in a finally.
// ─────────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { REPO_ROOT } from './config';
import { countTscErrors } from './gateChecks/baseline';
import type { BaselineCounts } from './types';

const execFileAsync = promisify(execFile);

/** A fresh worktree only checks out tracked files, so it has no node_modules.
 * Symlink in the main checkout's install rather than paying for a full `npm
 * ci` on every approval — safe as long as the diff doesn't touch
 * package.json, which the denylist check flags separately either way. */
function linkNodeModules(pkgDir: string, worktreeDir: string): void {
  const target = path.join(worktreeDir, pkgDir, 'node_modules');
  if (fs.existsSync(target)) return;
  fs.symlinkSync(path.join(REPO_ROOT, pkgDir, 'node_modules'), target, 'dir');
}

async function run(cmd: string, args: string[], cwd: string): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { cwd, maxBuffer: 32 * 1024 * 1024 });
    return { code: 0, output: `${stdout}\n${stderr}` };
  } catch (err: any) {
    return { code: err.code ?? 1, output: `${err.stdout ?? ''}\n${err.stderr ?? ''}` };
  }
}

/** Checks out `branch` into a scratch worktree, runs `npm run build` in
 * functions/ and `npx tsc --noEmit` in mobile-app/ when the diff touches
 * those packages, and returns the tsc/build error counts. Always removes
 * the worktree afterward, even on failure. */
export async function measureBuildBaselines(
  branch: string,
  changedFiles: string[]
): Promise<BaselineCounts> {
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wugi-approval-worktree-'));
  const counts: BaselineCounts = { functions: null, mobileApp: null };

  try {
    await execFileAsync('git', ['worktree', 'add', '--detach', worktreeDir, `origin/${branch}`], {
      cwd: REPO_ROOT,
    });

    const touchesFunctions = changedFiles.some((f) => f.startsWith('functions/'));
    const touchesMobileApp = changedFiles.some((f) => f.startsWith('mobile-app/'));

    if (touchesFunctions) {
      linkNodeModules('functions', worktreeDir);
      const functionsDir = path.join(worktreeDir, 'functions');
      const build = await run('npm', ['run', 'build'], functionsDir);
      counts.functions = countTscErrors(build.output);
    }

    if (touchesMobileApp) {
      linkNodeModules('mobile-app', worktreeDir);
      const mobileAppDir = path.join(worktreeDir, 'mobile-app');
      const tsc = await run('npx', ['tsc', '--noEmit'], mobileAppDir);
      counts.mobileApp = countTscErrors(tsc.output);
    }

    return counts;
  } finally {
    await execFileAsync('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: REPO_ROOT }).catch(
      () => {
        // Best-effort: if the worktree was never registered (e.g. `add` itself
        // failed) there's nothing to remove.
      }
    );
  }
}

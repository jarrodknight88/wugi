import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { REPO_ROOT } from './config';

const execFileAsync = promisify(execFile);

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

/** `git checkout main && git pull && git merge --no-ff origin/<branch> -m <msg> && git push`.
 * Runs against the daemon's own checkout at REPO_ROOT — the same repo the
 * daemon itself lives in, per the spec's execution steps. Returns the
 * resulting merge commit SHA. */
export async function mergeBranchIntoMain(branch: string, message: string): Promise<string> {
  await git(['checkout', 'main']);
  await git(['pull']);
  await git(['merge', '--no-ff', `origin/${branch}`, '-m', message]);
  await git(['push']);
  return git(['rev-parse', 'HEAD']);
}

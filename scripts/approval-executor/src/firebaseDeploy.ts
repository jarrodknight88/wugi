import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { REPO_ROOT } from './config';

const execFileAsync = promisify(execFile);

/** `firebase deploy --only functions:<names> --project wugi-prod` — single-function
 * targeting per AGENTS.md's Cloud Functions convention. Run from REPO_ROOT, where
 * firebase.json lives. Returns the last lines of output as the receipt tail. */
export async function deployFunctions(functionNames: string[]): Promise<string> {
  if (functionNames.length === 0) throw new Error('DEPLOY entry has no functionNames');
  const only = `functions:${functionNames.join(',')}`;
  const { stdout, stderr } = await execFileAsync(
    'firebase',
    ['deploy', '--only', only, '--project', 'wugi-prod'],
    { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 }
  );
  const output = `${stdout}\n${stderr}`.trim();
  return output.split('\n').slice(-20).join('\n');
}

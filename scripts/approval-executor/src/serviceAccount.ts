// Credentials: GOOGLE_APPLICATION_CREDENTIALS, scripts/approval-executor/serviceAccount.json,
// or mobile-app/scripts/serviceAccount.json (the SessionStart-hook location documented in
// CLAUDE.md). Mirrors the fallback order used by scripts/backfill-intel-media.js.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT } from './config';

export function loadServiceAccountPath(): string {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return process.env.GOOGLE_APPLICATION_CREDENTIALS;

  const candidates = [
    path.join(__dirname, '..', 'serviceAccount.json'),
    path.join(REPO_ROOT, 'mobile-app', 'scripts', 'serviceAccount.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'No serviceAccount.json found (looked in scripts/approval-executor/ and mobile-app/scripts/) ' +
      'and GOOGLE_APPLICATION_CREDENTIALS is unset.'
  );
}

// ─────────────────────────────────────────────────────────────────────
// Fetch-based GitHub REST client — mirrors the style of
// functions/src/bridge/shared.ts (no SDK) rather than introducing an
// Octokit dependency, since this daemon lives in a fresh package with
// its own node_modules and that's the repo's existing convention for
// talking to GitHub from Node.
// ─────────────────────────────────────────────────────────────────────

import { GITHUB_OWNER, GITHUB_REPO } from './config';
import type { GitHubPullRequest } from './types';

const GITHUB_API = 'https://api.github.com';

export class GithubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'GithubApiError';
  }
}

async function githubRequest(path: string, token: string): Promise<any> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'wugi-approval-executor',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new GithubApiError(res.status, `GitHub GET ${path} failed [${res.status}]: ${body}`);
  }
  return res.json();
}

export async function getPullRequest(prNumber: number, token: string): Promise<GitHubPullRequest | null> {
  try {
    const pr = await githubRequest(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls/${prNumber}`, token);
    return {
      number: pr.number,
      state: pr.state,
      merged: pr.merged === true,
      mergeable: pr.mergeable ?? null,
      title: pr.title,
      body: pr.body,
      head: { sha: pr.head.sha, ref: pr.head.ref },
      html_url: pr.html_url,
    };
  } catch (err) {
    if (err instanceof GithubApiError && err.status === 404) return null;
    throw err;
  }
}

/** Changed file paths for a PR, paginated (GitHub caps at 100/page). */
export async function listPullRequestFiles(prNumber: number, token: string): Promise<string[]> {
  const files: string[] = [];
  for (let page = 1; ; page++) {
    const batch = await githubRequest(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls/${prNumber}/files?per_page=100&page=${page}`,
      token
    );
    files.push(...batch.map((f: { filename: string }) => f.filename));
    if (batch.length < 100) break;
  }
  return files;
}

/** All other open PRs (excluding `excludePrNumber`), for the file-overlap check. */
export async function listOtherOpenPullRequests(
  excludePrNumber: number,
  token: string
): Promise<number[]> {
  const prs = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls?state=open&per_page=100`,
    token
  );
  return prs
    .map((pr: { number: number }) => pr.number)
    .filter((n: number) => n !== excludePrNumber);
}

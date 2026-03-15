import { Octokit } from "@octokit/rest";
import * as vscode from "vscode";

export interface GitHubIssueDetail {
  number: number;
  title: string;
  body: string | null;
  state: string;
  url: string;
  type: "issue" | "pull_request";
  mergedAt?: string | null;
}

let _octokit: Octokit | undefined;

function getOctokit(): Octokit | undefined {
  const token = vscode.workspace
    .getConfiguration("whyExists")
    .get<string>("githubToken", "")
    .trim();

  if (!token) return undefined;

  if (!_octokit) {
    _octokit = new Octokit({ auth: token });
  }
  return _octokit;
}

/** Resets the cached Octokit instance (e.g. when token changes) */
export function resetOctokit() {
  _octokit = undefined;
}

/**
 * Fetches details for a list of issue/PR numbers.
 * Silently skips any that fail (rate limit, not found, etc.).
 */
export async function fetchIssueDetails(
  owner: string,
  repo: string,
  numbers: number[]
): Promise<GitHubIssueDetail[]> {
  const octokit = getOctokit();
  if (!octokit || numbers.length === 0) return [];

  const uniqueNumbers = [...new Set(numbers)];
  const results: GitHubIssueDetail[] = [];

  await Promise.all(
    uniqueNumbers.map(async (number) => {
      try {
        const { data } = await octokit.issues.get({ owner, repo, issue_number: number });

        const isPR = "pull_request" in data;
        results.push({
          number: data.number,
          title: data.title,
          body: data.body ?? null,
          state: data.state,
          url: data.html_url,
          type: isPR ? "pull_request" : "issue",
          mergedAt: isPR ? (data as any).pull_request?.merged_at : undefined,
        });
      } catch {
        // Silently skip — issue may not exist or token lacks access
      }
    })
  );

  // Return sorted by number ascending
  return results.sort((a, b) => a.number - b.number);
}

import simpleGit, { DefaultLogFields, ListLogLine } from "simple-git";
import * as path from "path";
import * as vscode from "vscode";

export interface CommitEntry {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  message: string;
  issueRefs: IssueRef[];
}

export interface IssueRef {
  raw: string;      // e.g. "#123" or "JIRA-456"
  number?: number;  // numeric GitHub issue/PR number
  type: "github" | "unknown";
}

export interface BlameEntry {
  hash: string;
  author: string;
  date: string;
  line: number;
  content: string;
}

export interface FileHistory {
  filePath: string;
  relativePath: string;
  repoRoot: string;
  originCommit: CommitEntry | undefined;
  commits: CommitEntry[];
  blameEntries: BlameEntry[];
  remoteUrl: string | undefined;
}

/** Extracts #123 and JIRA-XXX style issue references from a commit message */
function parseIssueRefs(message: string): IssueRef[] {
  const refs: IssueRef[] = [];
  const githubPattern = /#(\d+)/g;
  let match;
  while ((match = githubPattern.exec(message)) !== null) {
    refs.push({ raw: match[0], number: parseInt(match[1], 10), type: "github" });
  }
  return refs;
}

function toCommitEntry(log: DefaultLogFields & ListLogLine): CommitEntry {
  return {
    hash: log.hash,
    shortHash: log.hash.slice(0, 7),
    author: log.author_name,
    email: log.author_email,
    date: log.date,
    message: log.message,
    issueRefs: parseIssueRefs(log.message + "\n" + (log.body ?? "")),
  };
}

export async function getFileHistory(
  fileUri: vscode.Uri,
  selectionRange?: vscode.Selection
): Promise<FileHistory> {
  const filePath = fileUri.fsPath;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
  const repoRoot = workspaceFolder?.uri.fsPath ?? path.dirname(filePath);
  const relativePath = path.relative(repoRoot, filePath);

  const git = simpleGit(repoRoot);
  const maxCommits = vscode.workspace.getConfiguration("whyExists").get<number>("maxCommits", 20);

  // --- Commit log for the file ---
  const logResult = await git.log({
    file: relativePath,
    maxCount: maxCommits,
    "--follow": null,
  } as any);

  const commits = logResult.all.map(toCommitEntry);
  const originCommit = commits[commits.length - 1];

  // --- Blame (full file or selection range) ---
  let blameEntries: BlameEntry[] = [];
  try {
    const blameArgs = ["blame", "--porcelain"];
    if (selectionRange) {
      const startLine = selectionRange.start.line + 1;
      const endLine = selectionRange.end.line + 1;
      blameArgs.push(`-L${startLine},${endLine}`);
    }
    blameArgs.push("--", relativePath);

    const blameOutput = await git.raw(blameArgs);
    blameEntries = parsePorcelainBlame(blameOutput);
  } catch {
    // blame may fail on untracked/new files — silently skip
  }

  // --- Remote URL ---
  let remoteUrl: string | undefined;
  try {
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin");
    remoteUrl = origin?.refs?.fetch;
  } catch {
    // no remote configured
  }

  return { filePath, relativePath, repoRoot, originCommit, commits, blameEntries, remoteUrl };
}

/**
 * Parses `git blame --porcelain` output into structured entries.
 * Porcelain format groups lines by commit hash header followed by file/line metadata.
 */
function parsePorcelainBlame(output: string): BlameEntry[] {
  const entries: BlameEntry[] = [];
  const lines = output.split("\n");

  let currentHash = "";
  let currentAuthor = "";
  let currentDate = "";
  let currentLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Header line: <40-char hash> <orig_line> <final_line> [num_lines]
    if (/^[0-9a-f]{40}\s/.test(line)) {
      const parts = line.split(" ");
      currentHash = parts[0];
      currentLine = parseInt(parts[2], 10);
      continue;
    }

    if (line.startsWith("author ")) {
      currentAuthor = line.slice(7);
      continue;
    }

    if (line.startsWith("author-time ")) {
      const ts = parseInt(line.slice(12), 10);
      currentDate = new Date(ts * 1000).toISOString().slice(0, 10);
      continue;
    }

    // Content line (starts with a tab)
    if (line.startsWith("\t")) {
      entries.push({
        hash: currentHash,
        author: currentAuthor,
        date: currentDate,
        line: currentLine,
        content: line.slice(1),
      });
    }
  }

  return entries;
}

/** Infers the GitHub owner/repo from the remote URL */
export function parseGitHubOwnerRepo(
  remoteUrl: string | undefined
): { owner: string; repo: string } | undefined {
  if (!remoteUrl) return undefined;

  // Matches both HTTPS and SSH formats:
  // https://github.com/owner/repo.git
  // git@github.com:owner/repo.git
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(\.git)?$/);
  if (!match) return undefined;

  return { owner: match[1], repo: match[2] };
}

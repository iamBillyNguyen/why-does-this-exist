import * as vscode from "vscode";
import simpleGit from "simple-git";

export const GIT_CONTENT_SCHEME = "whyexists-git";

export class GitContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const root = decodeURIComponent(params.get("root") ?? "");
    const file = decodeURIComponent(params.get("file") ?? "");
    const hash = params.get("hash") ?? "";

    if (!root || !file || !hash || hash === "empty") {
      return "";
    }

    try {
      const git = simpleGit(root);
      return await git.show([`${hash}:${file}`]);
    } catch {
      return `// Could not retrieve file content at commit ${hash}`;
    }
  }
}

/**
 * Builds a virtual URI for a file at a specific git commit.
 * The path includes the hash so VS Code treats each version as a distinct document.
 * The file extension is preserved so syntax highlighting works correctly.
 */
export function buildGitUri(
  repoRoot: string,
  relativePath: string,
  hash: string
): vscode.Uri {
  const fileName = relativePath.split("/").pop() ?? "file";
  return vscode.Uri.from({
    scheme: GIT_CONTENT_SCHEME,
    // e.g. /abc1234/extension.ts  — unique per commit, keeps extension for highlighting
    path: `/${hash}/${fileName}`,
    query: `root=${encodeURIComponent(repoRoot)}&file=${encodeURIComponent(relativePath)}&hash=${hash}`,
  });
}

import * as vscode from "vscode";
import * as path from "path";
import { getFileHistory, FileHistory, parseGitHubOwnerRepo } from "../gitService";
import { fetchIssueDetails, GitHubIssueDetail } from "../githubService";
import { buildGitUri } from "../gitContentProvider";

export class WhyExistsPanel {
  public static currentPanel: WhyExistsPanel | undefined;
  private static readonly viewType = "whyExists.panel";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];
  private _currentHistory: FileHistory | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext
  ) {
    this._panel = panel;
    this._context = context;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: { command: string; hash: string; parentHash: string }) => {
        if (message.command === "openDiff" && this._currentHistory) {
          const history = this._currentHistory;
          const beforeUri = buildGitUri(history.repoRoot, history.relativePath, message.parentHash);
          const afterUri  = buildGitUri(history.repoRoot, history.relativePath, message.hash);
          const shortHash = message.hash.slice(0, 7);
          const title = `${path.basename(history.filePath)} \u2190 ${shortHash}`;
          await vscode.commands.executeCommand("vscode.diff", beforeUri, afterUri, title);
        }
      },
      null,
      this._disposables
    );
  }

  public static async createOrShow(
    context: vscode.ExtensionContext,
    fileUri: vscode.Uri,
    selection: vscode.Selection | undefined
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (WhyExistsPanel.currentPanel) {
      WhyExistsPanel.currentPanel._panel.reveal(column);
      await WhyExistsPanel.currentPanel._load(fileUri, selection);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      WhyExistsPanel.viewType,
      "Why Does This Exist?",
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
        retainContextWhenHidden: true,
      }
    );

    WhyExistsPanel.currentPanel = new WhyExistsPanel(panel, context);
    await WhyExistsPanel.currentPanel._load(fileUri, selection);
  }

  private async _load(fileUri: vscode.Uri, selection: vscode.Selection | undefined) {
    this._panel.title = `Why: ${path.basename(fileUri.fsPath)}`;
    this._panel.webview.html = buildLoadingHtml();

    try {
      const history = await getFileHistory(fileUri, selection);
      this._currentHistory = history;
      const ownerRepo = parseGitHubOwnerRepo(history.remoteUrl);

      // Collect all unique GitHub issue/PR refs across all commits
      let issueDetails: GitHubIssueDetail[] = [];
      if (ownerRepo) {
        const allNumbers = [
          ...new Set(
            history.commits.flatMap((c) =>
              c.issueRefs
                .filter((r) => r.type === "github" && r.number !== undefined)
                .map((r) => r.number!)
            )
          ),
        ];
        issueDetails = await fetchIssueDetails(ownerRepo.owner, ownerRepo.repo, allNumbers);
      }

      const issueMap = new Map(issueDetails.map((i) => [i.number, i]));
      this._panel.webview.html = buildPanelHtml(history, issueMap, ownerRepo, selection);
    } catch (err: any) {
      this._panel.webview.html = buildErrorHtml(
        err?.message ?? "An unexpected error occurred."
      );
    }
  }

  public dispose() {
    WhyExistsPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
  }
}

// ---------------------------------------------------------------------------
// HTML builders
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "today";
    if (diffDays === 1) return "yesterday";
    if (diffDays < 30) return `${diffDays} days ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  } catch {
    return isoDate.slice(0, 10);
  }
}

function buildLoadingHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <style>
    body { font-family: var(--vscode-font-family); display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    .loader { text-align: center; }
    .dots { display: flex; gap: 6px; justify-content: center; margin-bottom: 1rem; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-textLink-foreground, #4ea6ff); animation: bounce 1.2s infinite ease-in-out; }
    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }
    .label { font-size: 0.85rem; opacity: 0.6; letter-spacing: 0.02em; }
  </style>
  </head><body>
  <div class="loader">
    <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    <div class="label">Analyzing git history…</div>
  </div>
  </body></html>`;
}

function buildErrorHtml(message: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <style>
    body { font-family: var(--vscode-font-family); padding: 2rem; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    .error { color: var(--vscode-errorForeground); background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); padding: 1rem; border-radius: 4px; }
  </style>
  </head><body><div class="error"><strong>Error:</strong> ${escapeHtml(message)}</div></body></html>`;
}

function buildPanelHtml(
  history: FileHistory,
  issueMap: Map<number, GitHubIssueDetail>,
  ownerRepo: { owner: string; repo: string } | undefined,
  selection: vscode.Selection | undefined
): string {
  const fileName = path.basename(history.filePath);
  const ext = path.extname(fileName).slice(1).toUpperCase();
  const origin = history.originCommit;
  const latest = history.commits[0];
  const selectionLabel = selection
    ? `lines ${selection.start.line + 1}–${selection.end.line + 1}`
    : "";

  // Unique contributors
  const contributors = [...new Set(history.commits.map((c) => c.author))];

  // --- Stats bar ---
  const statsBar = `
    <div class="stats-bar">
      <div class="stat">
        <span class="stat-value">${history.commits.length}</span>
        <span class="stat-label">commits</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat">
        <span class="stat-value">${contributors.length}</span>
        <span class="stat-label">${contributors.length === 1 ? "author" : "authors"}</span>
      </div>
      ${origin ? `
      <div class="stat-divider"></div>
      <div class="stat">
        <span class="stat-value">${escapeHtml(formatDate(origin.date))}</span>
        <span class="stat-label">created</span>
      </div>` : ""}
      ${issueMap.size > 0 ? `
      <div class="stat-divider"></div>
      <div class="stat">
        <span class="stat-value">${issueMap.size}</span>
        <span class="stat-label">linked ${issueMap.size === 1 ? "issue" : "issues"}</span>
      </div>` : ""}
    </div>`;

  // --- Section: Origin + Last Modified (side by side) ---
  const originCard = origin ? `
    <div class="half-card card-origin" data-hash="${origin.hash}" data-parent-hash="empty">
      <div class="card-label">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zm0 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM8 4a.75.75 0 0 1 .75.75v3.5h2a.75.75 0 0 1 0 1.5h-2.75A.75.75 0 0 1 7.25 9V4.75A.75.75 0 0 1 8 4z"/></svg>
        Origin
        <span class="card-diff-hint">⊕ view diff</span>
      </div>
      <div class="commit-block">
        <div class="commit-top">
          <span class="hash-pill">${escapeHtml(origin.shortHash)}</span>
          <span class="commit-age age-${ageClass(origin.date)}">${escapeHtml(formatDate(origin.date))}</span>
        </div>
        <p class="commit-msg">${escapeHtml(origin.message)}</p>
        <div class="avatar-row">
          <div class="avatar">${escapeHtml(origin.author.charAt(0).toUpperCase())}</div>
          <span class="author-name">${escapeHtml(origin.author)}</span>
        </div>
        ${renderIssueRefs(origin.issueRefs, issueMap, ownerRepo)}
      </div>
    </div>` : `<div class="half-card"><p class="muted">Untracked file — no git history found.</p></div>`;

  const latestCard = latest && latest.hash !== origin?.hash ? `
    <div class="half-card card-latest" data-hash="${latest.hash}" data-parent-hash="${history.commits[1]?.hash ?? 'empty'}">
      <div class="card-label">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zm.75 4.75a.75.75 0 0 0-1.5 0v4.5c0 .27.144.518.378.651l2.5 1.5a.75.75 0 1 0 .744-1.302L8.75 8.9V4.75z"/></svg>
        Last Modified
        <span class="card-diff-hint">⊕ view diff</span>
      </div>
      <div class="commit-block">
        <div class="commit-top">
          <span class="hash-pill">${escapeHtml(latest.shortHash)}</span>
          <span class="commit-age age-${ageClass(latest.date)}">${escapeHtml(formatDate(latest.date))}</span>
        </div>
        <p class="commit-msg">${escapeHtml(latest.message)}</p>
        <div class="avatar-row">
          <div class="avatar">${escapeHtml(latest.author.charAt(0).toUpperCase())}</div>
          <span class="author-name">${escapeHtml(latest.author)}</span>
        </div>
        ${renderIssueRefs(latest.issueRefs, issueMap, ownerRepo)}
      </div>
    </div>` : "";

  const overviewSection = `
    <div class="card-row">
      ${originCard}
      ${latestCard}
    </div>`;

  // --- Section: Linked Issues/PRs ---
  let issuesSection = "";
  if (issueMap.size > 0) {
    const issueCards = [...issueMap.values()]
      .map((issue) => {
        const isPR = issue.type === "pull_request";
        const stateClass = issue.state === "closed" ? "closed" : "open";
        const stateIcon = isPR
          ? (stateClass === "closed" ? "✓" : "⑂")
          : (stateClass === "closed" ? "✓" : "○");
        const bodySnippet = issue.body
          ? escapeHtml(issue.body.slice(0, 200)) + (issue.body.length > 200 ? "…" : "")
          : "";
        return `
          <div class="issue-card ${stateClass}">
            <div class="issue-left">
              <span class="issue-state-dot ${stateClass}">${stateIcon}</span>
            </div>
            <div class="issue-right">
              <div class="issue-header">
                <a href="${escapeHtml(issue.url)}" class="issue-title">${escapeHtml(issue.title)}</a>
                <span class="issue-meta">#${issue.number} · ${isPR ? "PR" : "Issue"} · ${escapeHtml(issue.state)}</span>
              </div>
              ${bodySnippet ? `<p class="issue-body">${bodySnippet}</p>` : ""}
            </div>
          </div>`;
      })
      .join("");

    issuesSection = `
      <section class="card card-issues">
        <h2>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0z"/></svg>
          Linked PRs &amp; Issues
          <span class="count">${issueMap.size}</span>
        </h2>
        <div class="issue-list">${issueCards}</div>
      </section>`;
  }

  // --- Section: Timeline ---
  const INITIAL_SHOWN = 5;
  const allTimelineItems = history.commits.map((c, i) => {
    const isLatest = i === 0;
    const isOrigin = i === history.commits.length - 1 && history.commits.length > 1;
    const parentHash = history.commits[i + 1]?.hash ?? "empty";
    return `
      <li class="timeline-item${isLatest ? " tl-latest" : ""}${isOrigin ? " tl-origin" : ""}" data-index="${i}" data-hash="${c.hash}" data-parent-hash="${parentHash}" title="Click to diff against parent">
        <div class="tl-line-wrap">
          <div class="tl-dot"></div>
          ${i < history.commits.length - 1 ? `<div class="tl-line"></div>` : ""}
        </div>
        <div class="tl-body">
          <div class="tl-top">
            <span class="hash-pill">${escapeHtml(c.shortHash)}</span>
            <span class="commit-age age-${ageClass(c.date)}">${escapeHtml(formatDate(c.date))}</span>
            ${isLatest ? `<span class="tl-badge latest-badge">latest</span>` : ""}
            ${isOrigin ? `<span class="tl-badge origin-badge">origin</span>` : ""}
            <span class="tl-diff-hint">⊕ view diff</span>
          </div>
          <p class="commit-msg">${escapeHtml(c.message)}</p>
          <div class="avatar-row">
            <div class="avatar avatar-sm">${escapeHtml(c.author.charAt(0).toUpperCase())}</div>
            <span class="author-name">${escapeHtml(c.author)}</span>
          </div>
          ${renderIssueRefs(c.issueRefs, issueMap, ownerRepo)}
        </div>
      </li>`;
  });

  const visibleItems = allTimelineItems.slice(0, INITIAL_SHOWN).join("");
  const hiddenItems = allTimelineItems.slice(INITIAL_SHOWN).join("");
  const showMoreBtn = history.commits.length > INITIAL_SHOWN
    ? `<button class="show-more-btn" onclick="toggleMore(this)">
        Show ${history.commits.length - INITIAL_SHOWN} more commits ▾
       </button>`
    : "";
  const hiddenSection = history.commits.length > INITIAL_SHOWN
    ? `<ul class="timeline hidden-commits" id="hidden-commits" hidden>${hiddenItems}</ul>`
    : "";

  const timelineSection = `
    <section class="card card-timeline">
      <h2>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1.75a.75.75 0 0 0-1.5 0v12.5c0 .415.336.75.75.75h13.5a.75.75 0 0 0 0-1.5H1.5V1.75zM5 9.75a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 5 9.75zm2.25-4a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1-.75-.75zM10.5 7a.75.75 0 0 0 0 1.5h.5a.75.75 0 0 0 0-1.5h-.5zm1.25 4.75a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1-.75-.75z"/></svg>
        Change History
        <span class="count">${history.commits.length}</span>
      </h2>
      <ul class="timeline">${visibleItems}</ul>
      ${hiddenSection}
      ${showMoreBtn}
    </section>`;

  // --- Section: Blame ---
  let blameSection = "";
  if (selection && history.blameEntries.length > 0) {
    const blameRows = history.blameEntries
      .map(
        (b, i) => `
        <tr class="${i % 2 === 0 ? "row-even" : "row-odd"}">
          <td class="blame-line">${b.line}</td>
          <td class="blame-hash"><span class="hash-pill hash-pill-sm">${escapeHtml(b.hash.slice(0, 7))}</span></td>
          <td class="blame-author">${escapeHtml(b.author)}</td>
          <td class="blame-date">${escapeHtml(b.date)}</td>
          <td class="blame-content"><code>${escapeHtml(b.content)}</code></td>
        </tr>`
      )
      .join("");

    blameSection = `
      <section class="card card-blame">
        <h2>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M5.75 1a.75.75 0 0 0-.75.75v3c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-3a.75.75 0 0 0-.75-.75h-4.5zm.75 3V2.5h3V4h-3zm-2.874-.467a.75.75 0 0 0-.752-1.298A1.75 1.75 0 0 0 2 4.75v7.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0 0 14 12.25v-7.5a1.75 1.75 0 0 0-.874-1.515.75.75 0 1 0-.752 1.298.25.25 0 0 1 .126.217v7.5a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25v-7.5a.25.25 0 0 1 .126-.217z"/></svg>
          Blame
          <span class="selection-label">${escapeHtml(selectionLabel)}</span>
        </h2>
        <div class="table-wrap">
          <table class="blame-table">
            <thead><tr><th>#</th><th>Commit</th><th>Author</th><th>Date</th><th>Content</th></tr></thead>
            <tbody>${blameRows}</tbody>
          </table>
        </div>
      </section>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Why Does This Exist?</title>
  <style>${getStyles()}</style>
</head>
<body>
  <header>
    <div class="header-top">
      <div class="header-title">
        <span class="header-icon">⁉</span>
        <div>
          <div class="header-filename">
            ${escapeHtml(fileName)}
            ${ext ? `<span class="ext-badge">${escapeHtml(ext)}</span>` : ""}
            ${selectionLabel ? `<span class="selection-chip">${escapeHtml(selectionLabel)}</span>` : ""}
          </div>
          <div class="header-path">${escapeHtml(history.relativePath)}</div>
        </div>
      </div>
      ${ownerRepo ? `<div class="repo-chip"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5v-9zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8V1.5z"/></svg> ${escapeHtml(ownerRepo.owner)}/${escapeHtml(ownerRepo.repo)}</div>`
        : `<div class="token-notice">⚠ Add GitHub token in settings for PR details</div>`}
    </div>
    ${statsBar}
  </header>

  <main>
    ${overviewSection}
    ${issuesSection}
    ${timelineSection}
    ${blameSection}
  </main>

  <script>
    const vscodeApi = acquireVsCodeApi();

    // Make overview cards (origin / last modified) clickable
    document.querySelectorAll('.half-card[data-hash]').forEach(function(card) {
      card.addEventListener('click', function() {
        document.querySelectorAll('.half-card[data-hash]').forEach(function(el) {
          el.classList.remove('card-selected');
        });
        document.querySelectorAll('.timeline-item').forEach(function(el) {
          el.classList.remove('tl-selected');
        });
        card.classList.add('card-selected');
        vscodeApi.postMessage({
          command: 'openDiff',
          hash: card.dataset.hash,
          parentHash: card.dataset.parentHash || 'empty'
        });
      });
    });

    // Make timeline items clickable — opens a diff editor for that commit
    document.querySelectorAll('.timeline-item[data-hash]').forEach(function(item) {
      item.addEventListener('click', function() {
        document.querySelectorAll('.timeline-item').forEach(function(el) {
          el.classList.remove('tl-selected');
        });
        document.querySelectorAll('.half-card[data-hash]').forEach(function(el) {
          el.classList.remove('card-selected');
        });
        item.classList.add('tl-selected');
        vscodeApi.postMessage({
          command: 'openDiff',
          hash: item.dataset.hash,
          parentHash: item.dataset.parentHash || 'empty'
        });
      });
    });

    function toggleMore(btn) {
      const hidden = document.getElementById('hidden-commits');
      if (!hidden) return;
      const isHidden = hidden.hidden;
      hidden.hidden = !isHidden;
      // After revealing hidden commits, attach click handlers to them too
      if (isHidden) {
        hidden.querySelectorAll('.timeline-item[data-hash]').forEach(function(item) {
          if (!item._clickBound) {
            item._clickBound = true;
            item.addEventListener('click', function() {
              document.querySelectorAll('.timeline-item').forEach(function(el) {
                el.classList.remove('tl-selected');
              });
              document.querySelectorAll('.half-card[data-hash]').forEach(function(el) {
                el.classList.remove('card-selected');
              });
              item.classList.add('tl-selected');
              vscodeApi.postMessage({
                command: 'openDiff',
                hash: item.dataset.hash,
                parentHash: item.dataset.parentHash || 'empty'
              });
            });
          }
        });
      }
      btn.textContent = isHidden
        ? 'Show fewer commits ▴'
        : btn.textContent.replace('▴', '▾').replace('fewer', '${history.commits.length - INITIAL_SHOWN} more');
    }
  </script>
</body>
</html>`;
}

/** Returns a CSS age class based on commit date for color coding */
function ageClass(isoDate: string): string {
  try {
    const diffDays = Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
    if (diffDays < 7) return "fresh";
    if (diffDays < 90) return "recent";
    if (diffDays < 365) return "old";
    return "ancient";
  } catch {
    return "old";
  }
}

function renderIssueRefs(
  refs: { raw: string; number?: number; type: string }[],
  issueMap: Map<number, GitHubIssueDetail>,
  ownerRepo: { owner: string; repo: string } | undefined
): string {
  if (refs.length === 0) return "";
  const chips = refs
    .map((r) => {
      const detail = r.number !== undefined ? issueMap.get(r.number) : undefined;
      if (detail) {
        return `<a href="${escapeHtml(detail.url)}" class="ref-chip ref-chip-linked" title="${escapeHtml(detail.title)}">${escapeHtml(r.raw)}</a>`;
      }
      if (ownerRepo && r.number !== undefined) {
        const url = `https://github.com/${ownerRepo.owner}/${ownerRepo.repo}/issues/${r.number}`;
        return `<a href="${escapeHtml(url)}" class="ref-chip">${escapeHtml(r.raw)}</a>`;
      }
      return `<span class="ref-chip">${escapeHtml(r.raw)}</span>`;
    })
    .join("");
  return `<div class="ref-chips">${chips}</div>`;
}

function getStyles(): string {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding-bottom: 3rem;
      line-height: 1.5;
    }

    a { color: var(--vscode-textLink-foreground); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* ── Header ── */
    header {
      padding: 1rem 1.25rem 0;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      position: sticky;
      top: 0;
      background: var(--vscode-editor-background);
      z-index: 10;
    }

    .header-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
      flex-wrap: wrap;
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }

    .header-icon {
      font-size: 1.5rem;
      line-height: 1;
      flex-shrink: 0;
    }

    .header-filename {
      font-size: 0.95rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
    }

    .header-path {
      font-size: 0.75rem;
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family, monospace);
      margin-top: 0.1rem;
      word-break: break-all;
    }

    .ext-badge {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 3px;
      padding: 0.05rem 0.35rem;
      font-size: 0.65rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      vertical-align: middle;
    }

    .selection-chip {
      background: color-mix(in srgb, var(--vscode-textLink-foreground) 15%, transparent);
      color: var(--vscode-textLink-foreground);
      border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 40%, transparent);
      border-radius: 99px;
      padding: 0.05rem 0.5rem;
      font-size: 0.7rem;
      font-family: var(--vscode-editor-font-family, monospace);
    }

    .repo-chip {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.75rem;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.05));
      border: 1px solid var(--vscode-panel-border, #444);
      border-radius: 99px;
      padding: 0.2rem 0.6rem;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .token-notice {
      font-size: 0.72rem;
      color: var(--vscode-editorWarning-foreground);
      flex-shrink: 0;
      align-self: center;
    }

    /* ── Stats Bar ── */
    .stats-bar {
      display: flex;
      align-items: center;
      gap: 0;
      padding: 0.5rem 0;
      overflow-x: auto;
    }

    .stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0 1rem;
      min-width: 4rem;
    }

    .stat:first-child { padding-left: 0; }

    .stat-value {
      font-size: 1rem;
      font-weight: 700;
      color: var(--vscode-foreground);
      line-height: 1.2;
    }

    .stat-label {
      font-size: 0.68rem;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-top: 0.05rem;
    }

    .stat-divider {
      width: 1px;
      height: 2rem;
      background: var(--vscode-panel-border, #444);
      flex-shrink: 0;
    }

    /* ── Main layout ── */
    main { padding: 0.875rem 1.25rem; display: flex; flex-direction: column; gap: 0.875rem; }

    /* ── Card Row (Origin + Latest) ── */
    .card-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }

    @media (max-width: 480px) { .card-row { grid-template-columns: 1fr; } }

    .half-card {
      background: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.03));
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 8px;
      padding: 0.875rem 1rem;
    }

    .card-label {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 0.65rem;
    }

    /* ── Standard card ── */
    .card {
      background: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.03));
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 8px;
      padding: 0.875rem 1rem;
    }

    .card h2 {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 0.75rem;
    }

    .count {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 99px;
      padding: 0 0.45rem;
      font-size: 0.65rem;
      line-height: 1.7;
      font-weight: 700;
    }

    .selection-label {
      font-family: var(--vscode-editor-font-family, monospace);
      font-weight: 400;
      text-transform: none;
      letter-spacing: 0;
      color: var(--vscode-textLink-foreground);
    }

    /* ── Commit block ── */
    .commit-block { display: flex; flex-direction: column; gap: 0.35rem; }

    .commit-top {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
    }

    .commit-msg {
      font-size: 0.85rem;
      color: var(--vscode-foreground);
      line-height: 1.45;
      word-break: break-word;
    }

    .muted { color: var(--vscode-descriptionForeground); font-size: 0.85rem; }

    /* ── Hash pill ── */
    .hash-pill {
      display: inline-block;
      background: var(--vscode-textBlockQuote-background, rgba(255,255,255,0.07));
      color: var(--vscode-textPreformat-foreground, #aaa);
      border-radius: 4px;
      padding: 0.1rem 0.4rem;
      font-size: 0.72rem;
      font-family: var(--vscode-editor-font-family, monospace);
      font-weight: 600;
      letter-spacing: 0.03em;
    }

    .hash-pill-sm { padding: 0.05rem 0.3rem; font-size: 0.68rem; }

    /* ── Age color coding ── */
    .commit-age {
      font-size: 0.75rem;
      border-radius: 99px;
      padding: 0.05rem 0.5rem;
      font-weight: 500;
    }

    .age-fresh  { background: rgba(74, 222, 128, 0.15); color: #4ade80; }
    .age-recent { background: rgba(96, 165, 250, 0.15); color: #60a5fa; }
    .age-old    { background: rgba(251, 191, 36, 0.12); color: #fbbf24; }
    .age-ancient{ background: rgba(148, 163, 184, 0.12); color: #94a3b8; }

    /* ── Avatar row ── */
    .avatar-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-top: 0.1rem;
    }

    .avatar {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--vscode-textLink-foreground, #4ea6ff);
      color: var(--vscode-editor-background, #1e1e1e);
      font-size: 0.65rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .avatar-sm { width: 16px; height: 16px; font-size: 0.6rem; }

    .author-name { font-size: 0.8rem; color: var(--vscode-descriptionForeground); }

    /* ── Timeline ── */
    .timeline { list-style: none; }

    .timeline-item {
      display: flex;
      gap: 0.75rem;
      padding-bottom: 0.25rem;
    }

    .tl-line-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex-shrink: 0;
      width: 16px;
      padding-top: 0.45rem;
    }

    .tl-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--vscode-panel-border, #555);
      border: 2px solid var(--vscode-editor-background);
      flex-shrink: 0;
      transition: background 0.2s;
    }

    .tl-line {
      width: 2px;
      flex: 1;
      min-height: 16px;
      background: var(--vscode-panel-border, #444);
      margin-top: 3px;
    }

    .tl-latest .tl-dot { background: var(--vscode-textLink-foreground, #4ea6ff); }
    .tl-origin .tl-dot  { background: #a78bfa; }

    .tl-body {
      padding: 0.35rem 0 0.75rem;
      flex: 1;
      min-width: 0;
    }

    .tl-top {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
      margin-bottom: 0.25rem;
      width: 100%;
    }

    .tl-badge {
      font-size: 0.65rem;
      font-weight: 700;
      border-radius: 99px;
      padding: 0.05rem 0.45rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .latest-badge { background: rgba(96,165,250,0.2); color: #60a5fa; }
    .origin-badge  { background: rgba(167,139,250,0.2); color: #a78bfa; }

    /* Show more */
    .hidden-commits { list-style: none; }

    .show-more-btn {
      margin-top: 0.5rem;
      background: none;
      border: 1px solid var(--vscode-panel-border, #444);
      border-radius: 5px;
      color: var(--vscode-textLink-foreground);
      font-size: 0.78rem;
      padding: 0.35rem 0.75rem;
      cursor: pointer;
      width: 100%;
      text-align: center;
      transition: background 0.15s;
    }

    .show-more-btn:hover {
      background: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.05));
    }

    /* ── Issue list ── */
    .issue-list { display: flex; flex-direction: column; gap: 0.5rem; }

    .issue-card {
      display: flex;
      gap: 0.65rem;
      padding: 0.65rem 0.75rem;
      border-radius: 6px;
      border: 1px solid var(--vscode-panel-border, #333);
      background: var(--vscode-editor-background);
    }

    .issue-left { flex-shrink: 0; padding-top: 0.1rem; }

    .issue-state-dot {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      font-size: 0.7rem;
      font-weight: 700;
    }

    .issue-state-dot.open   { background: rgba(74,222,128,0.15); color: #4ade80; }
    .issue-state-dot.closed { background: rgba(148,163,184,0.1); color: #94a3b8; }

    .issue-right { flex: 1; min-width: 0; }

    .issue-header {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .issue-title { font-size: 0.85rem; font-weight: 500; flex: 1; min-width: 0; }

    .issue-meta {
      font-size: 0.72rem;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }

    .issue-body {
      margin-top: 0.3rem;
      font-size: 0.78rem;
      color: var(--vscode-descriptionForeground);
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.45;
    }

    /* ── Ref chips ── */
    .ref-chips { display: flex; gap: 0.3rem; flex-wrap: wrap; margin-top: 0.35rem; }

    .ref-chip {
      display: inline-block;
      background: var(--vscode-textBlockQuote-background, rgba(255,255,255,0.06));
      border: 1px solid var(--vscode-panel-border, #444);
      border-radius: 99px;
      padding: 0.05rem 0.5rem;
      font-size: 0.72rem;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--vscode-foreground);
      transition: border-color 0.15s;
    }

    .ref-chip-linked {
      border-color: var(--vscode-textLink-foreground);
      color: var(--vscode-textLink-foreground);
    }

    /* ── Blame table ── */
    .table-wrap { overflow-x: auto; border-radius: 4px; }

    .blame-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.75rem;
      font-family: var(--vscode-editor-font-family, monospace);
    }

    .blame-table th {
      text-align: left;
      padding: 0.35rem 0.5rem;
      background: var(--vscode-editor-background);
      color: var(--vscode-descriptionForeground);
      font-weight: 700;
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 2px solid var(--vscode-panel-border, #444);
      position: sticky;
      top: 0;
    }

    .blame-table td {
      padding: 0.3rem 0.5rem;
      border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
      vertical-align: top;
    }

    .row-even { background: transparent; }
    .row-odd  { background: rgba(255,255,255,0.025); }

    .blame-line   { color: var(--vscode-editorLineNumber-foreground); width: 2rem; text-align: right; }
    .blame-hash   { width: 5rem; }
    .blame-author { width: 8rem; color: var(--vscode-descriptionForeground); }
    .blame-date   { width: 5.5rem; color: var(--vscode-descriptionForeground); }
    .blame-content code { white-space: pre; display: block; overflow: hidden; text-overflow: ellipsis; max-width: 280px; }

    /* ── Interactive timeline items ── */
    .timeline-item[data-hash] {
      cursor: pointer;
      border-radius: 6px;
      transition: background 0.15s, outline 0.15s;
      margin: 0 -0.5rem;
      padding-left: 0.5rem;
      padding-right: 0.5rem;
    }

    .timeline-item[data-hash]:hover {
      background: rgba(255,255,255,0.04);
    }

    .timeline-item[data-hash]:hover .tl-dot {
      transform: scale(1.25);
    }

    .timeline-item.tl-selected {
      background: rgba(251,146,60,0.09);
      outline: 1px solid rgba(251,146,60,0.35);
    }

    .timeline-item.tl-selected .tl-dot {
      background: #fb923c !important;
    }

    .tl-diff-hint {
      font-size: 0.68rem;
      color: var(--vscode-descriptionForeground);
      opacity: 0;
      transition: opacity 0.15s;
      margin-left: auto;
      padding-right: 0.25rem;
      white-space: nowrap;
    }

    .timeline-item[data-hash]:hover .tl-diff-hint { opacity: 1; }

    /* ── Interactive half-cards ── */
    .half-card[data-hash] {
      cursor: pointer;
      transition: background 0.15s, outline 0.15s;
    }

    .half-card[data-hash]:hover {
      outline: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground, #4ea6ff) 50%, transparent);
    }

    .half-card.card-selected {
      outline: 1px solid rgba(251,146,60,0.5) !important;
      background: rgba(251,146,60,0.07) !important;
    }

    .card-label {
      position: relative;
    }

    .card-diff-hint {
      font-size: 0.65rem;
      color: var(--vscode-descriptionForeground);
      opacity: 0;
      transition: opacity 0.15s;
      margin-left: auto;
      white-space: nowrap;
      font-weight: 400;
      text-transform: none;
      letter-spacing: 0;
    }

    .half-card[data-hash]:hover .card-diff-hint { opacity: 1; }

    /* ── Card accent colors ── */
    .card-origin {
      border-left: 3px solid #a78bfa;
      background: linear-gradient(135deg, rgba(167,139,250,0.07) 0%, var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.03)) 60%);
    }
    .card-origin .card-label { color: #a78bfa; }

    .card-latest {
      border-left: 3px solid #60a5fa;
      background: linear-gradient(135deg, rgba(96,165,250,0.07) 0%, var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.03)) 60%);
    }
    .card-latest .card-label { color: #60a5fa; }

    .card-issues {
      border-left: 3px solid #4ade80;
      background: linear-gradient(135deg, rgba(74,222,128,0.06) 0%, var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.03)) 60%);
    }
    .card-issues h2 { color: #4ade80; }

    .card-timeline {
      border-left: 3px solid #fb923c;
      background: linear-gradient(135deg, rgba(251,146,60,0.06) 0%, var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.03)) 60%);
    }
    .card-timeline h2 { color: #fb923c; }

    .card-blame {
      border-left: 3px solid #fbbf24;
      background: linear-gradient(135deg, rgba(251,191,36,0.06) 0%, var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.03)) 60%);
    }
    .card-blame h2 { color: #fbbf24; }
  `;
}

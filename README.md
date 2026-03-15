# Why Does This Exist?

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/BillyNguyen.why-does-this-exist?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=BillyNguyen.why-does-this-exist)

A Visual Studio Code extension that answers the question *"why does this file or code exist?"* by surfacing git history, blame information, and linked GitHub issues/PRs in a single side panel — on demand.

> **[Install from the VS Code Marketplace →](https://marketplace.visualstudio.com/items?itemName=BillyNguyen.why-does-this-exist)**

---

## Features

- **File history** — see every commit that touched the current file, with author, date, and message.
- **Git blame** — view line-by-line blame for the whole file or just a selected range.
- **GitHub issue & PR enrichment** — commit messages containing `#123`-style references are automatically resolved to issue/PR titles, state, and links (requires a GitHub token).
- **Inline diff viewer** — click any commit in the panel to open a side-by-side diff of that change directly in VS Code.
- **Selection-aware** — highlight a block of lines and run the command to scope history and blame to only those lines.
- **Follows renames** — uses `git log --follow` so history survives file renames.

---

## Usage

### On a file (Explorer or editor)

Right-click any file in the Explorer panel or inside the editor and choose **Why Does This Exist?**

This opens the history panel beside your current editor, showing all commits that modified the file.

### On a selection (editor)

Select one or more lines in the editor, then right-click and choose **Why Does This Exist? (Selection)**

The panel will show blame and history scoped to the selected line range.

### Command Palette

You can also run either command from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command | Description |
|---|---|
| `WhyExists: Why Does This Exist?` | Explain the active file |
| `WhyExists: Why Does This Exist? (Selection)` | Explain the current selection |

---

## Extension Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `whyExists.githubToken` | `string` | `""` | GitHub Personal Access Token for fetching PR and issue details. Optional — history and blame work without it. |
| `whyExists.maxCommits` | `number` | `20` | Maximum number of commits to load in the history panel. |

### Setting up a GitHub Token (optional)

To enable PR/issue enrichment:

1. Go to **GitHub → Settings → Developer settings → Personal access tokens**.
2. Generate a token with the `repo` scope (or `public_repo` for public repositories only).
3. Open VS Code Settings (`Cmd+,`) and search for `whyExists.githubToken`.
4. Paste your token.

---

## Requirements

- The file must be inside a git repository.
- VS Code **1.85.0** or newer.
- GitHub integration requires a valid Personal Access Token with repository read access.

---

## License

MIT


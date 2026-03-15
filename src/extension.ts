import * as vscode from "vscode";
import { WhyExistsPanel } from "./panel/WhyExistsPanel";
import { GitContentProvider, GIT_CONTENT_SCHEME } from "./gitContentProvider";

export function activate(context: vscode.ExtensionContext) {
  const contentProvider = new GitContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(GIT_CONTENT_SCHEME, contentProvider)
  );

  // Command: right-click a file in the explorer
  const explainFileCmd = vscode.commands.registerCommand(
    "whyExists.explainFile",
    (uri?: vscode.Uri) => {
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!targetUri) {
        vscode.window.showWarningMessage("No file selected.");
        return;
      }
      WhyExistsPanel.createOrShow(context, targetUri, undefined);
    }
  );

  // Command: right-click with a selection in the editor
  const explainSelectionCmd = vscode.commands.registerCommand(
    "whyExists.explainSelection",
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor.");
        return;
      }
      const selection = editor.selection.isEmpty ? undefined : editor.selection;
      WhyExistsPanel.createOrShow(context, editor.document.uri, selection);
    }
  );

  context.subscriptions.push(explainFileCmd, explainSelectionCmd);
}

export function deactivate() {}

import {
  applyEdits,
  findNodeAtLocation,
  modify,
  parseTree,
} from "jsonc-parser";
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand(
    "jsonPathExpander.insertPathAndValue",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("Open a JSON/JSONC file first.");
        return;
      }

      const doc = editor.document;
      const languageId = doc.languageId;
      if (languageId !== "json" && languageId !== "jsonc") {
        const proceed = await vscode.window.showQuickPick(["Yes", "No"], {
          placeHolder: "Active file is not JSON/JSONC. Continue anyway?",
        });
        if (proceed !== "Yes") return;
      }

      const pathInput = await vscode.window.showInputBox({
        prompt: "Enter JSON path (dot notation, arrays like a.b[0].c)",
        placeHolder: "path.[0].to.json.key",
      });
      if (!pathInput) return;

      const valueInput = await vscode.window.showInputBox({
        prompt:
          "Enter value (raw JSON; strings need quotes, or leave unquoted to force string)",
        placeHolder: '"enter value"  |  123  |  true  |  {"x":1}',
      });
      if (valueInput === undefined) return;

      const path = parsePath(pathInput);
      if (!path.length) {
        vscode.window.showErrorMessage("Path could not be parsed.");
        return;
      }

      const originalText = doc.getText();
      const text = originalText.trim().length === 0 ? "{}" : originalText;

      const value = coerceValue(valueInput);
      const formatting = detectFormattingOptions(doc);

      let edits;
      try {
        edits = modify(text, path, value, { formattingOptions: formatting });
      } catch (e: any) {
        vscode.window.showErrorMessage(
          `Failed to compute edits: ${e?.message ?? String(e)}`
        );
        return;
      }

      const newText = applyEdits(text, edits);

      await editor.edit((builder) => {
        const fullRange = new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(originalText.length)
        );
        builder.replace(fullRange, newText);
      });

      tryRevealPath(editor, newText, path);
      vscode.window.setStatusBarMessage(
        "JSON Path Expander: value inserted.",
        2500
      );
    }
  );

  context.subscriptions.push(cmd);
}

export function deactivate() {}

function parsePath(input: string): (string | number)[] {
  const parts: (string | number)[] = [];
  let i = 0;
  while (i < input.length) {
    if (input[i] === ".") {
      i++;
      continue;
    }
    if (input[i] === "[") {
      const close = input.indexOf("]", i + 1);
      if (close === -1) return [];
      const inside = input.slice(i + 1, close).trim();
      if (/^\d+$/.test(inside)) {
        parts.push(Number(inside));
      } else if (
        (inside.startsWith('"') && inside.endsWith('"')) ||
        (inside.startsWith("'") && inside.endsWith("'"))
      ) {
        parts.push(inside.slice(1, -1));
      } else {
        parts.push(inside);
      }
      i = close + 1;
      if (i < input.length && input[i] === ".") i++;
      continue;
    }
    let j = i;
    while (j < input.length && input[j] !== "." && input[j] !== "[") j++;
    const token = input.slice(i, j).trim();
    if (token.length) parts.push(token);
    i = j;
  }
  return parts;
}

function coerceValue(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function detectFormattingOptions(doc: vscode.TextDocument) {
  const editor = vscode.window.activeTextEditor;
  const useTabs = editor ? !editor.options.insertSpaces : false;
  const tabSize = editor ? Number(editor.options.tabSize) : 2;
  return {
    insertSpaces: !useTabs,
    tabSize,
  };
}

function tryRevealPath(
  editor: vscode.TextEditor,
  text: string,
  path: (string | number)[]
) {
  try {
    const tree = parseTree(text);
    if (!tree) return;
    const node = findNodeAtLocation(tree, path);
    if (!node) return;
    const start = editor.document.positionAt(node.offset);
    const end = editor.document.positionAt(node.offset + node.length);
    editor.revealRange(
      new vscode.Range(start, end),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
    editor.selection = new vscode.Selection(start, start);
  } catch {}
}

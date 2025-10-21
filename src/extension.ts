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
        vscode.window.showErrorMessage("Open a JSON/JSONC/JS/TS file first.");
        return;
      }

      const doc = editor.document;
      const languageId = doc.languageId;
      if (
        languageId !== "json" &&
        languageId !== "jsonc" &&
        languageId !== "javascript" &&
        languageId !== "typescript"
      ) {
        const proceed = await vscode.window.showQuickPick(["Yes", "No"], {
          placeHolder: "Active file is not JSON/JSONC/JS/TS. Continue anyway?",
        });
        if (proceed !== "Yes") return;
      }

      const originalText = doc.getText();
      let text = originalText.trim().length === 0 ? "{}" : originalText;
      let prefix = "";
      let suffix = "";
      let isWrapped = false;

      let variableName: string | undefined;
      if (languageId === "javascript" || languageId === "typescript") {
        const variables = findJsonVariables(originalText);
        if (variables.length === 0) {
          vscode.window.showErrorMessage(
            "No valid JSON object variables found in the file."
          );
          return;
        }
        variableName = await vscode.window.showQuickPick(
          variables.map((v) => v.name),
          {
            placeHolder: "Select a variable containing a JSON object",
          }
        );
        if (!variableName) return;

        const selectedVar = variables.find((v) => v.name === variableName);
        if (!selectedVar) {
          vscode.window.showErrorMessage("Selected variable not found.");
          return;
        }

        text = selectedVar.json;
        prefix = originalText.slice(0, selectedVar.jsonStart);
        suffix = originalText.slice(selectedVar.jsonEnd);
        isWrapped = true;
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

      let newText = applyEdits(text, edits);

      if (isWrapped) {
        newText = `${prefix}${newText}${suffix}`;
      }

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

function findJsonVariables(
  text: string
): { name: string; json: string; jsonStart: number; jsonEnd: number }[] {
  const variables: {
    name: string;
    json: string;
    jsonStart: number;
    jsonEnd: number;
  }[] = [];
  const regex =
    /(?:export\s+)?(?:const|let|var\s+)?(\w+)?\s*=\s*({[\s\S]*?})(?:;|$)|({[\s\S]*?})(?:;|$)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const name = match[1] || `Object_${variables.length + 1}`;
    const json = match[2] || match[3];
    try {
      parseTree(json);
      const jsonStart = match.index + match[0].indexOf(json);
      const jsonEnd = jsonStart + json.length;
      variables.push({
        name,
        json,
        jsonStart,
        jsonEnd,
      });
    } catch {}
  }

  return variables;
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

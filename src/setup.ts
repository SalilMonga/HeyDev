import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

// Hook script is bundled as a file at scripts/heydev-hook.sh
// Read it at runtime from the extension's install directory

const HEYDEV_HOOKS = {
  Notification: [
    {
      matcher: "idle_prompt|permission_prompt|elicitation_dialog",
      hooks: [
        {
          type: "command",
          command: "~/.claude/scripts/heydev-hook.sh waiting",
          async: true,
        },
      ],
    },
  ],
  PreToolUse: [
    {
      hooks: [
        {
          type: "command",
          command: "~/.claude/scripts/heydev-hook.sh working",
          async: true,
        },
      ],
    },
  ],
  Stop: [
    {
      hooks: [
        {
          type: "command",
          command: "~/.claude/scripts/heydev-hook.sh waiting",
          async: true,
        },
      ],
    },
  ],
  UserPromptSubmit: [
    {
      hooks: [
        {
          type: "command",
          command: "~/.claude/scripts/heydev-hook.sh working",
          async: true,
        },
      ],
    },
  ],
};

interface ClaudeSettings {
  env?: Record<string, string>;
  hooks?: Record<string, unknown[]>;
  [key: string]: unknown;
}

function checkCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function checkClaude(): Promise<boolean> {
  if (checkCommand("claude")) return true;

  // Claude not found globally — ask user to point to it
  const action = await vscode.window.showWarningMessage(
    "HeyDev couldn't find Claude Code CLI. Is it installed?",
    "It's installed elsewhere",
    "Install Claude Code",
    "Skip (I'll configure manually)"
  );

  if (action === "Install Claude Code") {
    vscode.env.openExternal(vscode.Uri.parse("https://claude.ai/code"));
    return false;
  }
  if (action === "It's installed elsewhere") {
    const path = await vscode.window.showInputBox({
      prompt: "Enter the path to your Claude Code CLI",
      placeHolder: "/usr/local/bin/claude",
    });
    if (path) {
      try {
        execSync(`"${path}" --version`, { stdio: "ignore" });
        return true;
      } catch {
        vscode.window.showErrorMessage(`Could not run Claude at: ${path}`);
        return false;
      }
    }
    return false;
  }
  // "Skip" — let them proceed, they'll configure hooks manually
  return action === "Skip (I'll configure manually)";
}

function installHookScript(extensionPath: string): string {
  const scriptDir = path.join(os.homedir(), ".claude", "scripts");
  const scriptPath = path.join(scriptDir, "heydev-hook.sh");

  // Read the bundled hook script from the extension's install directory
  const bundledScript = path.join(extensionPath, "scripts", "heydev-hook.sh");
  const scriptContent = fs.readFileSync(bundledScript, "utf-8");

  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

  return scriptPath;
}

function mergeClaudeSettings(): { added: string[]; skipped: string[] } {
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  const added: string[] = [];
  const skipped: string[] = [];

  let settings: ClaudeSettings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {
      // Backup corrupted file
      const backupPath = settingsPath + ".backup";
      fs.copyFileSync(settingsPath, backupPath);
      settings = {};
    }
  }

  // Add env var
  if (!settings.env) settings.env = {};
  if (!settings.env["CLAUDE_CODE_DISABLE_TERMINAL_TITLE"]) {
    settings.env["CLAUDE_CODE_DISABLE_TERMINAL_TITLE"] = "1";
    added.push("CLAUDE_CODE_DISABLE_TERMINAL_TITLE env var");
  } else {
    skipped.push("CLAUDE_CODE_DISABLE_TERMINAL_TITLE (already set)");
  }

  // Add hooks — merge with existing, don't replace
  if (!settings.hooks) settings.hooks = {};

  for (const [event, hookEntries] of Object.entries(HEYDEV_HOOKS)) {
    const existing = settings.hooks[event] as unknown[] | undefined;

    // Check if HeyDev hooks are already configured
    const hasHeydev = existing?.some((entry: unknown) => {
      const e = entry as { hooks?: Array<{ command?: string }> };
      return e.hooks?.some((h) => h.command?.includes("heydev-hook.sh"));
    });

    if (hasHeydev) {
      skipped.push(`${event} hook (already configured)`);
    } else {
      // Append our hooks to existing ones
      if (existing) {
        settings.hooks[event] = [...existing, ...hookEntries];
      } else {
        settings.hooks[event] = hookEntries;
      }
      added.push(`${event} hook`);
    }
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  return { added, skipped };
}

export async function runSetup(extensionPath: string): Promise<void> {
  // Step 1: Check for Claude Code
  const claudeOk = await checkClaude();
  if (!claudeOk) return;

  // Step 2: Check for jq
  if (!checkCommand("jq")) {
    const install = await vscode.window.showErrorMessage(
      "HeyDev requires 'jq' to be installed. Install it and try again.",
      "How to Install"
    );
    if (install === "How to Install") {
      vscode.env.openExternal(
        vscode.Uri.parse("https://jqlang.github.io/jq/download/")
      );
    }
    return;
  }

  // Step 3: Install hook script
  const scriptPath = installHookScript(extensionPath);

  // Step 4: Merge Claude settings
  const { added, skipped } = mergeClaudeSettings();

  // Step 5: Create state directory
  const stateDir = path.join(os.homedir(), ".claude", "terminal-status");
  fs.mkdirSync(stateDir, { recursive: true });

  // Step 6: Show results
  const lines: string[] = [];

  if (added.length > 0) {
    lines.push(`Configured: ${added.join(", ")}`);
  }
  if (skipped.length > 0) {
    lines.push(`Already set: ${skipped.join(", ")}`);
  }
  lines.push(`Hook script: ${scriptPath}`);

  const message =
    added.length > 0
      ? `HeyDev setup complete! Restart your Claude Code sessions to activate.\n\n${lines.join("\n")}`
      : `HeyDev is already configured. ${lines.join(". ")}`;

  const action = await vscode.window.showInformationMessage(
    message,
    added.length > 0 ? "Open Claude Settings" : "OK"
  );

  if (action === "Open Claude Settings") {
    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
    const doc = await vscode.workspace.openTextDocument(settingsPath);
    await vscode.window.showTextDocument(doc);
  }
}

export async function runUninstall(): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    "Remove HeyDev hooks from Claude Code settings?",
    "Yes",
    "Cancel"
  );

  if (confirm !== "Yes") return;

  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");

  if (!fs.existsSync(settingsPath)) {
    vscode.window.showInformationMessage("No Claude settings found.");
    return;
  }

  try {
    const settings: ClaudeSettings = JSON.parse(
      fs.readFileSync(settingsPath, "utf-8")
    );

    // Remove env var
    if (settings.env) {
      delete settings.env["CLAUDE_CODE_DISABLE_TERMINAL_TITLE"];
      if (Object.keys(settings.env).length === 0) delete settings.env;
    }

    // Remove HeyDev hooks from each event
    if (settings.hooks) {
      for (const event of Object.keys(settings.hooks)) {
        const entries = settings.hooks[event] as unknown[];
        settings.hooks[event] = entries.filter((entry: unknown) => {
          const e = entry as { hooks?: Array<{ command?: string }> };
          return !e.hooks?.some((h) => h.command?.includes("heydev-hook.sh"));
        });
        // Remove empty arrays
        if ((settings.hooks[event] as unknown[]).length === 0) {
          delete settings.hooks[event];
        }
      }
      if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    // Remove hook script
    const scriptPath = path.join(
      os.homedir(),
      ".claude",
      "scripts",
      "heydev-hook.sh"
    );
    if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);

    vscode.window.showInformationMessage(
      "HeyDev hooks removed. Restart Claude Code sessions to take effect."
    );
  } catch {
    vscode.window.showErrorMessage("Failed to update Claude settings.");
  }
}

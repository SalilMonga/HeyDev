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
          command: "~/.heydev/heydev-hook.sh waiting Claude",
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
          command: "~/.heydev/heydev-hook.sh working Claude",
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
          command: "~/.heydev/heydev-hook.sh waiting Claude",
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
          command: "~/.heydev/heydev-hook.sh working Claude",
          async: true,
        },
      ],
    },
  ],
};

const CODEX_HOOKS = {
  Stop: [
    {
      hooks: [
        {
          type: "command",
          command: "~/.heydev/heydev-hook.sh waiting Codex",
          timeout: 10,
        },
      ],
    },
  ],
  PostToolUse: [
    {
      hooks: [
        {
          type: "command",
          command: "~/.heydev/heydev-hook.sh working Codex",
          timeout: 10,
        },
      ],
    },
  ],
  UserPromptSubmit: [
    {
      hooks: [
        {
          type: "command",
          command: "~/.heydev/heydev-hook.sh working Codex",
          timeout: 10,
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

interface CodexHooksFile {
  hooks?: Record<string, unknown[]>;
}

function checkCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function getCodexHome(): string {
  const envHome = process.env.CODEX_HOME?.trim();
  return envHome && envHome.length > 0
    ? envHome
    : path.join(os.homedir(), ".codex");
}

function ensureCodexTerminalTitleDisabledInToml(
  content: string
): { content: string; changed: boolean } {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.length > 0 ? content.split(/\r?\n/) : [];
  const outLines: string[] = [];
  let currentSection = "";
  let hasTuiSection = false;
  let hasDisabledTitle = false;
  let changed = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);

    if (sectionMatch) {
      if (currentSection === "tui" && !hasDisabledTitle) {
        if (
          outLines.length > 0 &&
          outLines[outLines.length - 1].trim().length > 0
        ) {
          outLines.push("");
        }
        outLines.push("terminal_title = []");
        hasDisabledTitle = true;
        changed = true;
      }

      currentSection = sectionMatch[1].trim();
      if (currentSection === "tui") hasTuiSection = true;
      outLines.push(line);
      continue;
    }

    // Migrate legacy (incorrect) root-level key from older HeyDev versions.
    if (currentSection === "" && /^terminal_title\s*=/.test(trimmed)) {
      changed = true;
      continue;
    }

    // Support dotted style too.
    if (/^tui\.terminal_title\s*=/.test(trimmed)) {
      hasDisabledTitle = true;
      if (!/^tui\.terminal_title\s*=\s*(\[\s*\]|null)\s*(#.*)?$/.test(trimmed)) {
        outLines.push("tui.terminal_title = []");
        changed = true;
      } else if (/=\s*null\s*(#.*)?$/.test(trimmed)) {
        // Normalize to [] for broader TOML parser compatibility.
        outLines.push("tui.terminal_title = []");
        changed = true;
      } else {
        outLines.push(line);
      }
      continue;
    }

    if (currentSection === "tui" && /^terminal_title\s*=/.test(trimmed)) {
      hasDisabledTitle = true;
      if (!/^terminal_title\s*=\s*(\[\s*\]|null)\s*(#.*)?$/.test(trimmed)) {
        outLines.push("terminal_title = []");
        changed = true;
      } else if (/=\s*null\s*(#.*)?$/.test(trimmed)) {
        // Normalize to [] for broader TOML parser compatibility.
        outLines.push("terminal_title = []");
        changed = true;
      } else {
        outLines.push(line);
      }
      continue;
    }

    outLines.push(line);
  }

  if (currentSection === "tui" && !hasDisabledTitle) {
    if (outLines.length > 0 && outLines[outLines.length - 1].trim().length > 0) {
      outLines.push("");
    }
    outLines.push("terminal_title = []");
    hasDisabledTitle = true;
    changed = true;
  }

  if (!hasTuiSection && !hasDisabledTitle) {
    if (outLines.length > 0 && outLines[outLines.length - 1].trim().length > 0) {
      outLines.push("");
    }
    outLines.push("[tui]");
    outLines.push("terminal_title = []");
    changed = true;
  }

  return { content: outLines.join(newline), changed };
}

export function ensureCodexTerminalTitleDisabled(): boolean {
  const codexHome = getCodexHome();
  const configToml = path.join(codexHome, "config.toml");
  const original = fs.existsSync(configToml)
    ? fs.readFileSync(configToml, "utf-8")
    : "";
  const result = ensureCodexTerminalTitleDisabledInToml(original);

  if (!fs.existsSync(configToml) || result.changed) {
    fs.mkdirSync(path.dirname(configToml), { recursive: true });
    fs.writeFileSync(configToml, result.content);
    return true;
  }
  return false;
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
  const scriptDir = path.join(os.homedir(), ".heydev");
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

function mergeCodexSettings(): { added: string[]; skipped: string[] } {
  const hooksPath = path.join(getCodexHome(), "hooks.json");
  const added: string[] = [];
  const skipped: string[] = [];

  let hooksFile: CodexHooksFile = {};
  if (fs.existsSync(hooksPath)) {
    try {
      hooksFile = JSON.parse(fs.readFileSync(hooksPath, "utf-8"));
    } catch {
      const backupPath = hooksPath + ".backup";
      fs.copyFileSync(hooksPath, backupPath);
      hooksFile = {};
    }
  }

  if (!hooksFile.hooks) hooksFile.hooks = {};

  for (const [event, hookEntries] of Object.entries(CODEX_HOOKS)) {
    const existing = hooksFile.hooks[event] as unknown[] | undefined;

    const hasHeydev = existing?.some((entry: unknown) => {
      const e = entry as { hooks?: Array<{ command?: string }> };
      return e.hooks?.some((h) => h.command?.includes("heydev-hook.sh"));
    });

    if (hasHeydev) {
      skipped.push(`Codex ${event} hook (already configured)`);
    } else {
      if (existing) {
        hooksFile.hooks[event] = [...existing, ...hookEntries];
      } else {
        hooksFile.hooks[event] = hookEntries;
      }
      added.push(`Codex ${event} hook`);
    }
  }

  fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
  fs.writeFileSync(hooksPath, JSON.stringify(hooksFile, null, 2));

  // Disable Codex's built-in terminal title manager so HeyDev owns the tab title.
  if (ensureCodexTerminalTitleDisabled()) {
    added.push("Codex terminal title disabled");
  } else {
    skipped.push("Codex terminal title (already disabled)");
  }

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

  // Step 4b: Merge Codex settings if Codex is installed
  if (checkCommand("codex")) {
    const codexResult = mergeCodexSettings();
    added.push(...codexResult.added);
    skipped.push(...codexResult.skipped);
  }

  // Step 5: Create state directory
  const stateDir = path.join(os.homedir(), ".heydev", "state");
  fs.mkdirSync(stateDir, { recursive: true });

  // Step 6: Configure VS Code terminal title setting
  const termConfig = vscode.workspace.getConfiguration("terminal.integrated.tabs");
  const currentTitle = termConfig.get<string>("title", "${process}");

  if (!currentTitle.includes("${sequence}")) {
    const scope = await vscode.window.showInformationMessage(
      "HeyDev needs to set terminal.integrated.tabs.title to \"${sequence}\" so terminal tab names update. Where should this be applied?",
      { detail: "User (global) applies to all projects. Workspace applies only to this project.", modal: true },
      "User (Recommended)",
      "Workspace Only",
      "Skip"
    );

    if (scope === "User (Recommended)") {
      await termConfig.update("title", "${sequence}", vscode.ConfigurationTarget.Global);
      // Also set description to show process name as subtitle
      await termConfig.update("description", "${task}${separator}${local}", vscode.ConfigurationTarget.Global);
      added.push("VS Code terminal title setting (User)");
    } else if (scope === "Workspace Only") {
      await termConfig.update("title", "${sequence}", vscode.ConfigurationTarget.Workspace);
      await termConfig.update("description", "${task}${separator}${local}", vscode.ConfigurationTarget.Workspace);
      added.push("VS Code terminal title setting (Workspace)");
    } else {
      skipped.push("VS Code terminal title setting (skipped)");
    }
  } else {
    skipped.push("VS Code terminal title (already configured)");
  }

  // Step 7: Show results
  const hasCodex = checkCommand("codex");

  if (added.length === 0) {
    const hasCodexInstalled = checkCommand("codex");
    const configuredTools = ["Claude"];
    if (hasCodexInstalled) configuredTools.push("Codex");

    vscode.window.showInformationMessage(
      `HeyDev is already configured for ${configuredTools.join(" & ")}.`,
      "OK"
    );
    return;
  }

  // Build tool list for short message
  const tools = ["Claude"];
  if (hasCodex) tools.push("Codex");

  // Log details to output channel for those who want them
  const output = vscode.window.createOutputChannel("HeyDev Setup");
  output.appendLine("=== HeyDev Setup Complete ===\n");
  output.appendLine("Configured:");
  for (const item of added) {
    output.appendLine(`  + ${item}`);
  }
  if (skipped.length > 0) {
    output.appendLine("\nAlready set:");
    for (const item of skipped) {
      output.appendLine(`  - ${item}`);
    }
  }
  output.appendLine(`\nHook script: ${scriptPath}`);
  output.appendLine(`State directory: ${path.join(os.homedir(), ".heydev", "state")}`);
  output.appendLine("\nRestart your AI CLI sessions to activate.");

  output.appendLine("\nConfig files:");
  output.appendLine(`  Claude: ${path.join(os.homedir(), ".claude", "settings.json")}`);
  if (hasCodex) {
    output.appendLine(`  Codex:  ${path.join(getCodexHome(), "hooks.json")}`);
  }

  const action = await vscode.window.showWarningMessage(
    `HeyDev configured for ${tools.join(" & ")}. Restart your AI CLI sessions (close & reopen terminal) to activate hooks.`,
    "View Details",
    "Open Settings"
  );

  if (action === "View Details") {
    output.show();
  } else if (action === "Open Settings") {
    // Open both config files in tabs
    const claudePath = path.join(os.homedir(), ".claude", "settings.json");
    if (fs.existsSync(claudePath)) {
      const doc = await vscode.workspace.openTextDocument(claudePath);
      await vscode.window.showTextDocument(doc, { preview: false });
    }
    if (hasCodex) {
      const codexPath = path.join(getCodexHome(), "hooks.json");
      if (fs.existsSync(codexPath)) {
        const doc = await vscode.workspace.openTextDocument(codexPath);
        await vscode.window.showTextDocument(doc, { preview: false });
      }
    }
  }
}

export async function runUninstall(): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    "Remove HeyDev hooks from all AI CLIs (Claude Code, Codex)?",
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

    // Remove hook script (check both old and new locations)
    const scriptPath = path.join(os.homedir(), ".heydev", "heydev-hook.sh");
    if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
    const oldScriptPath = path.join(os.homedir(), ".claude", "scripts", "heydev-hook.sh");
    if (fs.existsSync(oldScriptPath)) fs.unlinkSync(oldScriptPath);

    // Remove Codex hooks too
    const codexHooksPath = path.join(getCodexHome(), "hooks.json");
    if (fs.existsSync(codexHooksPath)) {
      try {
        const codexHooks: CodexHooksFile = JSON.parse(
          fs.readFileSync(codexHooksPath, "utf-8")
        );
        if (codexHooks.hooks) {
          for (const event of Object.keys(codexHooks.hooks)) {
            const entries = codexHooks.hooks[event] as unknown[];
            codexHooks.hooks[event] = entries.filter((entry: unknown) => {
              const e = entry as { hooks?: Array<{ command?: string }> };
              return !e.hooks?.some((h) => h.command?.includes("heydev-hook.sh"));
            });
            if ((codexHooks.hooks[event] as unknown[]).length === 0) {
              delete codexHooks.hooks[event];
            }
          }
          if (Object.keys(codexHooks.hooks).length === 0) delete codexHooks.hooks;
        }
        fs.writeFileSync(codexHooksPath, JSON.stringify(codexHooks, null, 2));
      } catch {
        // Codex hooks file unreadable — skip
      }
    }

    // Offer to revert VS Code terminal title setting
    const termConfig = vscode.workspace.getConfiguration("terminal.integrated.tabs");
    const currentTitle = termConfig.get<string>("title", "");
    if (currentTitle === "${sequence}") {
      const revert = await vscode.window.showInformationMessage(
        "Revert terminal tab title setting to default?",
        "Yes",
        "No"
      );
      if (revert === "Yes") {
        await termConfig.update("title", undefined, vscode.ConfigurationTarget.Global);
        await termConfig.update("title", undefined, vscode.ConfigurationTarget.Workspace);
        await termConfig.update("description", undefined, vscode.ConfigurationTarget.Global);
        await termConfig.update("description", undefined, vscode.ConfigurationTarget.Workspace);
      }
    }

    vscode.window.showInformationMessage(
      "HeyDev hooks removed from all AI CLIs. Restart your sessions to take effect."
    );
  } catch {
    vscode.window.showErrorMessage("Failed to update Claude settings.");
  }
}

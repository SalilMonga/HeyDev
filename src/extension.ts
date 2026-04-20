import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { SessionWatcher } from "./sessionWatcher.js";
import { TerminalManager } from "./terminalManager.js";
import { NotificationManager } from "./notificationManager.js";
import { ensureCodexTerminalTitleDisabled, runSetup, runUninstall } from "./setup.js";
import { isProcessAlive } from "./types.js";
import type { SessionState } from "./types.js";

function syncEmojiConfig(): void {
  const config = vscode.workspace.getConfiguration("heydev");
  const emojiConfig = {
    workingEmoji: config.get<string>("workingEmoji", "⚡"),
    waitingEmoji: config.get<string>("waitingEmoji", "👀"),
  };
  const heydevDir = path.join(os.homedir(), ".heydev");
  fs.mkdirSync(heydevDir, { recursive: true });
  fs.writeFileSync(
    path.join(heydevDir, "emoji-config.json"),
    JSON.stringify(emojiConfig, null, 2)
  );
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("heydev");
  const customDir = config.get<string>("stateDirectory", "");
  const stateDir = customDir || path.join(os.homedir(), ".heydev", "state");
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");

  const watcher = new SessionWatcher(stateDir);
  const terminalMgr = new TerminalManager();
  const notificationMgr = new NotificationManager(terminalMgr);

  // Register commands
  const extPath = context.extensionPath;
  context.subscriptions.push(
    vscode.commands.registerCommand("heydev.setup", () => runSetup(extPath)),
    vscode.commands.registerCommand("heydev.removeHooks", runUninstall)
  );

  // Clean up stale state files on startup (older than 5 minutes)
  // Prevents notifications for sessions that ended before VS Code restarted
  if (fs.existsSync(stateDir)) {
    const now = Date.now();
    for (const file of fs.readdirSync(stateDir).filter((f) => f.endsWith(".json") && f !== "emoji-config.json")) {
      try {
        const filePath = path.join(stateDir, file);
        const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const ageMs = now - (content.timestamp * 1000);
        if (ageMs > 5 * 60 * 1000 || !isProcessAlive(content.shell_pid)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Skip unparseable files
      }
    }
  }

  // Migrate old state files from ~/.claude/terminal-status/ to ~/.heydev/state/
  const oldStateDir = path.join(os.homedir(), ".claude", "terminal-status");
  if (fs.existsSync(oldStateDir)) {
    const newStateDir = path.join(os.homedir(), ".heydev", "state");
    fs.mkdirSync(newStateDir, { recursive: true });
    for (const file of fs.readdirSync(oldStateDir).filter(f => f.endsWith(".json") && f !== "emoji-config.json")) {
      try {
        fs.renameSync(path.join(oldStateDir, file), path.join(newStateDir, file));
      } catch { /* skip */ }
    }
  }

  // Keep backward compatibility for upgrades: silently fix older Codex title config.
  try {
    execSync("which codex", { stdio: "ignore" });
    ensureCodexTerminalTitleDisabled();
  } catch {
    // Ignore if codex is absent or write fails; setup can still repair manually.
  }

  // Check if setup is complete — prompt if any piece is missing
  const hookScript = path.join(os.homedir(), ".heydev", "heydev-hook.sh");
  const oldHookScript = path.join(os.homedir(), ".claude", "scripts", "heydev-hook.sh");
  const claudeSettingsPath = path.join(os.homedir(), ".claude", "settings.json");
  const termTitle = vscode.workspace.getConfiguration("terminal.integrated.tabs").get<string>("title", "${process}");

  // Check Claude hooks
  let claudeSetupNeeded = false;
  if (!fs.existsSync(hookScript) && !fs.existsSync(oldHookScript)) {
    claudeSetupNeeded = true;
  } else if (!termTitle.includes("${sequence}")) {
    claudeSetupNeeded = true;
  } else if (fs.existsSync(claudeSettingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, "utf-8"));
      const hasHooks = Object.values(settings.hooks ?? {}).some((entries: unknown) =>
        (entries as Array<{ hooks?: Array<{ command?: string }> }>).some((e) =>
          e.hooks?.some((h) => h.command?.includes("heydev-hook.sh"))
        )
      );
      if (!hasHooks) claudeSetupNeeded = true;
    } catch {
      claudeSetupNeeded = true;
    }
  } else {
    claudeSetupNeeded = true;
  }

  // Check Codex hooks (only if codex is installed)
  let codexSetupNeeded = false;
  const codexHooksPath = path.join(codexHome, "hooks.json");
  try {
    execSync("which codex", { stdio: "ignore" });
    // Codex installed — check if HeyDev hooks configured
    if (fs.existsSync(codexHooksPath)) {
      try {
        const codexHooks = JSON.parse(fs.readFileSync(codexHooksPath, "utf-8"));
        const hasHeydev = Object.values(codexHooks.hooks ?? {}).some((entries: unknown) =>
          (entries as Array<{ hooks?: Array<{ command?: string }> }>).some((e) =>
            e.hooks?.some((h) => h.command?.includes("heydev-hook.sh"))
          )
        );
        if (!hasHeydev) codexSetupNeeded = true;
      } catch {
        codexSetupNeeded = true;
      }
    } else {
      codexSetupNeeded = true;
    }
  } catch {
    // Codex not installed — skip
  }

  const setupNeeded = claudeSetupNeeded || codexSetupNeeded;
  if (setupNeeded) {
    const tools = [claudeSetupNeeded ? "Claude Code" : "", codexSetupNeeded ? "Codex" : ""].filter(Boolean).join(" & ");
    const action = await vscode.window.showInformationMessage(
      `HeyDev needs setup for ${tools}. Configure now?`,
      "Run Setup",
      "Later"
    );
    if (action === "Run Setup") {
      await runSetup(extPath);
    }
  }

  // Sync emoji config on activation and when settings change
  syncEmojiConfig();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("heydev")) {
        syncEmojiConfig();
      }
    })
  );

  // Suppress notifications during initial state read — only update terminal mappings
  let notificationsReady = false;

  watcher.on("stateChange", (state: SessionState) => {
    terminalMgr.updateSession(state);
    if (notificationsReady) {
      notificationMgr.handleStateChange(state);
    }
  });

  // Clean up stale files from previous sessions
  watcher.cleanupStaleFiles();

  // Start watching (readExistingStates fires synchronously — notifications suppressed)
  watcher.start();
  notificationsReady = true;
  terminalMgr.start();
  notificationMgr.start();

  context.subscriptions.push({
    dispose: () => {
      watcher.dispose();
      terminalMgr.dispose();
      notificationMgr.dispose();
    },
  });

  console.log("HeyDev extension activated");
}

export function deactivate(): void {
  // Cleanup handled by dispose
}

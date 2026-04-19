import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SessionWatcher } from "./sessionWatcher.js";
import { TerminalManager } from "./terminalManager.js";
import { NotificationManager } from "./notificationManager.js";
import { runSetup, runUninstall } from "./setup.js";
import { isProcessAlive } from "./types.js";
import type { SessionState } from "./types.js";

function syncEmojiConfig(stateDir: string): void {
  const config = vscode.workspace.getConfiguration("heydev");
  const emojiConfig = {
    workingEmoji: config.get<string>("workingEmoji", "⚡"),
    waitingEmoji: config.get<string>("waitingEmoji", "👀"),
  };
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "emoji-config.json"),
    JSON.stringify(emojiConfig, null, 2)
  );
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("heydev");
  const customDir = config.get<string>("stateDirectory", "");
  const stateDir = customDir || path.join(os.homedir(), ".claude", "terminal-status");

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

  // Check if setup is complete — prompt if any piece is missing
  const hookScript = path.join(os.homedir(), ".claude", "scripts", "heydev-hook.sh");
  const claudeSettingsPath = path.join(os.homedir(), ".claude", "settings.json");
  const termTitle = vscode.workspace.getConfiguration("terminal.integrated.tabs").get<string>("title", "${process}");

  let setupNeeded = false;
  if (!fs.existsSync(hookScript)) {
    setupNeeded = true;
  } else if (!termTitle.includes("${sequence}")) {
    setupNeeded = true;
  } else if (fs.existsSync(claudeSettingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, "utf-8"));
      const hasHooks = Object.values(settings.hooks ?? {}).some((entries: unknown) =>
        (entries as Array<{ hooks?: Array<{ command?: string }> }>).some((e) =>
          e.hooks?.some((h) => h.command?.includes("heydev-hook.sh"))
        )
      );
      if (!hasHooks) setupNeeded = true;
    } catch {
      setupNeeded = true;
    }
  } else {
    setupNeeded = true;
  }

  if (setupNeeded) {
    const action = await vscode.window.showInformationMessage(
      "HeyDev needs setup to work. Configure Claude Code integration now?",
      "Run Setup",
      "Later"
    );
    if (action === "Run Setup") {
      await runSetup(extPath);
    }
  }

  // Sync emoji config on activation and when settings change
  syncEmojiConfig(stateDir);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("heydev")) {
        syncEmojiConfig(stateDir);
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

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SessionWatcher } from "./sessionWatcher.js";
import { TerminalManager } from "./terminalManager.js";
import { NotificationManager } from "./notificationManager.js";
import { runSetup, runUninstall } from "./setup.js";
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
        if (ageMs > 5 * 60 * 1000) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Skip unparseable files
      }
    }
  }

  // Prompt setup on first install if hook script doesn't exist
  const stateFiles = fs.existsSync(stateDir)
    ? fs.readdirSync(stateDir).filter((f) => f.endsWith(".json") && f !== "emoji-config.json")
    : [];
  const hookScript = path.join(os.homedir(), ".claude", "scripts", "heydev-hook.sh");
  if (!fs.existsSync(hookScript) && stateFiles.length === 0) {
    const action = await vscode.window.showInformationMessage(
      "Welcome to HeyDev! Run setup to configure Claude Code integration.",
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

  watcher.on("stateChange", (state: SessionState) => {
    terminalMgr.updateSession(state);
    notificationMgr.handleStateChange(state);
  });

  // Clean up stale files from previous sessions
  watcher.cleanupStaleFiles();

  // Start watching
  watcher.start();
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

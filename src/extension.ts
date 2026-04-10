import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SessionWatcher } from "./sessionWatcher.js";
import { TerminalManager } from "./terminalManager.js";
import { NotificationManager } from "./notificationManager.js";
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

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration("heydev");
  const customDir = config.get<string>("stateDirectory", "");
  const stateDir = customDir || path.join(os.homedir(), ".claude", "terminal-status");

  const watcher = new SessionWatcher(stateDir);
  const terminalMgr = new TerminalManager();
  const notificationMgr = new NotificationManager(terminalMgr);

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

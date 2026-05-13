import * as vscode from "vscode";
import * as path from "path";
import * as cp from "child_process";
import * as notifier from "node-notifier";
import type { SessionState } from "./types.js";
import type { TerminalManager } from "./terminalManager.js";

export class NotificationManager {
  private terminalManager: TerminalManager;
  private extensionPath: string;
  private outputChannel: vscode.OutputChannel;
  // Pending in-app notification timers per session — cancelled if state changes or terminal focused
  private pendingTimers = new Map<string, NodeJS.Timeout>();
  // Pending mac escalation timers per session — scheduled after in-app fires
  private pendingMacTimers = new Map<string, NodeJS.Timeout>();
  // Active mac notification group IDs (for programmatic dismissal via terminal-notifier -remove)
  private activeMacNotifGroups = new Map<string, string>();
  // Track which sessions have a visible in-app notification so we can ignore stale clicks
  private activeNotifications = new Set<string>();
  // Track sessions that have already been notified — don't re-notify until state cycles back through "working"
  private _alreadyNotified = new Set<string>();
  // Per-session resolver to programmatically dismiss the withProgress in-app notification.
  // Calling the resolver dismisses the in-app popup naturally via VS Code's own UI.
  private inAppDismissers = new Map<string, () => void>();
  // Track currently-waiting sessions so the Quick Reply command can find them.
  private waitingSessions = new Map<string, SessionState>();
  private disposables: vscode.Disposable[] = [];

  // Traced accessors for alreadyNotified — log every add/delete so we can see exactly when state changes.
  private alreadyNotifiedAdd(sessionId: string, source: string): void {
    this._alreadyNotified.add(sessionId);
    this.outputChannel.appendLine(
      `[alreadyNotified] +ADD session ${sessionId} (by ${source}) — set size: ${this._alreadyNotified.size}`
    );
  }
  private alreadyNotifiedDelete(sessionId: string, source: string): void {
    const had = this._alreadyNotified.has(sessionId);
    this._alreadyNotified.delete(sessionId);
    this.outputChannel.appendLine(
      `[alreadyNotified] -DEL session ${sessionId} (by ${source}) — had=${had} set size: ${this._alreadyNotified.size}`
    );
  }
  private get alreadyNotified() {
    return {
      has: (id: string) => this._alreadyNotified.has(id),
      // Compatibility stubs — should never be called directly; use traced helpers
      add: (id: string) => this.alreadyNotifiedAdd(id, "direct"),
      delete: (id: string) => this.alreadyNotifiedDelete(id, "direct"),
      clear: () => this._alreadyNotified.clear(),
    };
  }

  constructor(terminalManager: TerminalManager, extensionPath: string) {
    this.terminalManager = terminalManager;
    this.extensionPath = extensionPath;
    this.outputChannel = vscode.window.createOutputChannel("HeyDev");
  }

  start(): void {
    // Cancel everything when a terminal is closed
    this.terminalManager.onTerminalClosed((sessionId) => {
      this.cancelAll(sessionId, "terminal closed");
      this.alreadyNotifiedDelete(sessionId, "terminal closed");
    });

    // Cancel pending notifications when user manually switches to a Claude terminal.
    // Note: we do NOT add to alreadyNotified here — that would persist across waiting
    // cycles. The activeTerminal guard in showNotification handles "currently looking."
    this.disposables.push(
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        if (!terminal) return;
        for (const [sessionId, tracked] of this.terminalManager.getAllSessions()) {
          if (tracked.terminal === terminal) {
            this.outputChannel.appendLine(
              `[focus] terminal for session ${sessionId} became active — cancelling pending`
            );
            this.cancelAll(sessionId, "terminal focused");
            break;
          }
        }
      })
    );
  }

  /** Called on every state change. Schedules or cancels notifications. */
  handleStateChange(state: SessionState): void {
    this.outputChannel.appendLine(
      `[state] session ${state.session_id} -> ${state.state} (tag=${state.tag})`
    );
    if (state.state === "waiting") {
      this.scheduleNotification(state);
    } else {
      // State changed to "working" — cancel pending in-app + mac, dismiss active mac, reset notified flag
      this.cancelAll(state.session_id, "state -> working");
      this.alreadyNotifiedDelete(state.session_id, "state -> working");
    }
  }

  private scheduleNotification(state: SessionState): void {
    const config = vscode.workspace.getConfiguration("heydev");
    if (!config.get<boolean>("showNotifications", true)) {
      this.outputChannel.appendLine(
        `[in-app] skipped for session ${state.session_id} (showNotifications=false)`
      );
      return;
    }

    // Only notify for sessions that belong to a terminal in THIS VS Code instance
    if (!this.terminalManager.getTerminalForSession(state.session_id)) {
      this.outputChannel.appendLine(
        `[in-app] skipped for session ${state.session_id} (terminal not tracked in this window)`
      );
      return;
    }

    // Don't re-notify if we already sent one for this waiting period
    if (this.alreadyNotified.has(state.session_id)) {
      this.outputChannel.appendLine(
        `[in-app] skipped for session ${state.session_id} (alreadyNotified)`
      );
      return;
    }

    // Don't schedule if there's already a pending timer
    if (this.pendingTimers.has(state.session_id)) {
      this.outputChannel.appendLine(
        `[in-app] skipped for session ${state.session_id} (timer already pending)`
      );
      return;
    }

    const delaySeconds = config.get<number>("notificationDelaySeconds", 60);
    const delayMs = delaySeconds * 1000;

    this.outputChannel.appendLine(
      `[in-app] scheduled for session ${state.session_id} in ${delaySeconds}s`
    );

    const timer = setTimeout(() => {
      this.pendingTimers.delete(state.session_id);
      this.showNotification(state, delaySeconds);
    }, delayMs);

    this.pendingTimers.set(state.session_id, timer);
  }

  private async showNotification(state: SessionState, delaySeconds: number): Promise<void> {
    const terminal = this.terminalManager.getTerminalForSession(state.session_id);

    // Don't notify if the terminal is already focused
    if (terminal && vscode.window.activeTerminal === terminal) {
      this.outputChannel.appendLine(
        `[in-app] suppressed for session ${state.session_id} (terminal is active)`
      );
      return;
    }

    this.outputChannel.appendLine(
      `[in-app] firing for session ${state.session_id}`
    );

    const timeLabel = delaySeconds >= 60
      ? `${Math.round(delaySeconds / 60)} minute${Math.round(delaySeconds / 60) > 1 ? "s" : ""}`
      : `${delaySeconds} second${delaySeconds !== 1 ? "s" : ""}`;

    // Build message with optional context snippet
    const snippet = state.last_message
      ? `: "${state.last_message.slice(0, 100)}${state.last_message.length > 100 ? "..." : ""}"`
      : "";

    const message = delaySeconds === 0
      ? `[${state.tag}] needs your attention${snippet}`
      : `[${state.tag}] waiting${snippet}`;

    // Mark this notification as active and already notified
    this.activeNotifications.add(state.session_id);
    this.alreadyNotifiedAdd(state.session_id, "showNotification");
    this.waitingSessions.set(state.session_id, state);

    // Schedule mac escalation in parallel with awaiting in-app interaction
    this.scheduleMacEscalation(state, snippet);

    // V2 — withProgress instead of showInformationMessage so we can dismiss programmatically.
    // The promise we return controls the notification lifetime:
    //   - User clicks Cancel → token.onCancellationRequested → resolve → dismiss
    //   - Mac click handler calls our stored dismisser → resolve → dismiss
    //   - state -> working → cancelMacEscalation also calls dismisser → resolve → dismiss
    // VS Code uses its own Cancel button label, which we cannot rename. We treat Cancel
    // as the "Focus Terminal" action — a slight UX wart, documented in CHANGELOG and #23.
    let dismissReason: string = "external";
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: message,
        cancellable: true,
      },
      (_progress, token) => {
        return new Promise<void>((resolve) => {
          this.inAppDismissers.set(state.session_id, () => {
            dismissReason = "external";
            this.inAppDismissers.delete(state.session_id);
            resolve();
          });
          token.onCancellationRequested(() => {
            dismissReason = "cancel";
            this.inAppDismissers.delete(state.session_id);
            resolve();
          });
        });
      }
    );

    // After in-app dismisses for any reason — cancel mac escalation
    this.cancelMacEscalation(state.session_id, `in-app dismissed (${dismissReason})`);
    this.activeNotifications.delete(state.session_id);

    this.outputChannel.appendLine(
      `[in-app] dismissed for session ${state.session_id} (${dismissReason})`
    );

    // User-initiated cancel = treat as "Focus Terminal" action
    if (dismissReason === "cancel" && terminal) {
      terminal.show();
    }
  }

  /** Public — called by the heydev.quickReply command. Returns the active waiting sessions. */
  getWaitingSessions(): SessionState[] {
    return [...this.waitingSessions.values()];
  }

  /** Public — send a quick reply to a specific session's terminal. */
  async sendQuickReply(sessionId: string): Promise<void> {
    const state = this.waitingSessions.get(sessionId);
    if (!state) {
      vscode.window.showWarningMessage(`Session ${sessionId} is no longer waiting.`);
      return;
    }
    const terminal = this.terminalManager.getTerminalForSession(sessionId);
    if (!terminal) {
      vscode.window.showWarningMessage(`No tracked terminal for session ${sessionId}.`);
      return;
    }
    const reply = await vscode.window.showInputBox({
      prompt: `Reply to [${state.tag}]`,
      placeHolder: "Type your response (e.g. yes, no, continue...)",
    });
    if (reply !== undefined && reply.trim() !== "") {
      terminal.sendText(reply.trim());
    }
  }

  private scheduleMacEscalation(state: SessionState, snippet: string): void {
    if (process.platform !== "darwin") return;

    const config = vscode.workspace.getConfiguration("heydev");
    if (!config.get<boolean>("enableMacNotifications", true)) return;

    if (this.pendingMacTimers.has(state.session_id)) return;

    const delaySeconds = config.get<number>("macNotificationDelaySeconds", 30);
    const workspacePath = this.getWorkspacePath();
    const playSound = config.get<boolean>("macNotificationSound", false);

    this.outputChannel.appendLine(
      `[mac-notif] scheduled for session ${state.session_id} in ${delaySeconds}s`
    );

    const timer = setTimeout(() => {
      this.pendingMacTimers.delete(state.session_id);
      this.fireMacNotification(state, snippet, workspacePath, playSound);
    }, delaySeconds * 1000);

    this.pendingMacTimers.set(state.session_id, timer);
  }

  private fireMacNotification(
    state: SessionState,
    snippet: string,
    workspacePath: string | undefined,
    playSound: boolean
  ): void {
    const terminal = this.terminalManager.getTerminalForSession(state.session_id);
    // Last-second guard: if terminal got focused while timer was running, skip
    if (terminal && vscode.window.activeTerminal === terminal) {
      this.outputChannel.appendLine(
        `[mac-notif] suppressed for session ${state.session_id} (terminal focused)`
      );
      return;
    }

    const groupId = `heydev-${state.session_id}`;
    this.activeMacNotifGroups.set(state.session_id, groupId);

    const iconPath = path.join(this.extensionPath, "images", "icon.png");
    const message = snippet
      ? snippet.replace(/^: /, "").replace(/^"|"$/g, "")
      : "AI session needs your attention";

    // Spawn terminal-notifier directly with detached:true so it escapes the extension host's
    // process group. node-notifier's default spawn keeps the child attached, and VS Code's
    // hardened-runtime extension host appears to block notification UI from attached children.
    const terminalNotifierPath = path.join(
      this.extensionPath,
      "node_modules",
      "node-notifier",
      "vendor",
      "mac.noindex",
      "terminal-notifier.app",
      "Contents",
      "MacOS",
      "terminal-notifier"
    );

    const args = [
      "-title", `[${state.tag}] waiting`,
      "-message", message,
      "-appIcon", iconPath,
      "-group", groupId,
      "-timeout", "60",
    ];
    if (playSound) args.push("-sound", "default");

    this.outputChannel.appendLine(
      `[mac-notif] fired for session ${state.session_id} (binary=${terminalNotifierPath})`
    );

    const child = cp.spawn(terminalNotifierPath, args, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Collect stdout for click detection. terminal-notifier emits @CONTENTCLICKED on click,
    // @TIMEOUT on auto-dismiss, @CLOSED on user dismissal.
    let stdoutBuf = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
    });
    child.on("error", (err) => {
      this.outputChannel.appendLine(
        `[mac-notif] spawn error: ${err.message}`
      );
      this.activeMacNotifGroups.delete(state.session_id);
    });
    child.on("close", (code) => {
      this.outputChannel.appendLine(
        `[mac-notif] subprocess exited code=${code} stdout="${stdoutBuf.trim()}"`
      );
      // terminal-notifier emits: @CONTENTCLICKED (body click), @ACTIONCLICKED (action button),
      // @TIMEOUT (auto-dismiss), @CLOSED (manual dismiss). Treat any "click" type as a click.
      const wasClicked =
        stdoutBuf.includes("@CONTENTCLICKED") ||
        stdoutBuf.includes("@ACTIONCLICKED") ||
        stdoutBuf.includes("activate");
      if (wasClicked) {
        this.outputChannel.appendLine(
          `[mac-notif] click handler invoked for session ${state.session_id}`
        );
        // Bring VS Code app to foreground (from a background space / another app).
        this.focusVSCodeWindow(workspacePath);
        // Then focus the specific terminal — same as in-app "Focus Terminal" button.
        const targetTerminal = this.terminalManager.getTerminalForSession(state.session_id);
        if (targetTerminal) {
          this.outputChannel.appendLine(
            `[mac-notif] calling terminal.show() for session ${state.session_id}`
          );
          targetTerminal.show();
        } else {
          this.outputChannel.appendLine(
            `[mac-notif] no terminal tracked for session ${state.session_id} — window focus only`
          );
        }
        // Programmatically dismiss the in-app withProgress notification (V2).
        const dismisser = this.inAppDismissers.get(state.session_id);
        if (dismisser) {
          this.outputChannel.appendLine(
            `[mac-notif] dismissing in-app for session ${state.session_id}`
          );
          dismisser();
        }
      }
      this.activeMacNotifGroups.delete(state.session_id);
    });
    // Detach the child so it can outlive the extension host's process group if needed.
    child.unref();
  }

  private cancelMacEscalation(sessionId: string, reason: string): void {
    const timer = this.pendingMacTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.pendingMacTimers.delete(sessionId);
      this.outputChannel.appendLine(
        `[mac-notif] cancelled for session ${sessionId} (${reason})`
      );
    }
    const groupId = this.activeMacNotifGroups.get(sessionId);
    if (groupId) {
      this.dismissActiveMacNotif(groupId);
      this.activeMacNotifGroups.delete(sessionId);
    }
  }

  private dismissActiveMacNotif(groupId: string): void {
    if (process.platform !== "darwin") return;
    // terminal-notifier -remove <group> dismisses the notification by group ID
    // Cast to any — `remove` is a valid terminal-notifier flag but missing from @types/node-notifier
    notifier.notify({ remove: groupId } as any, () => {
      // Ignore errors — best-effort dismissal
    });
  }

  private focusVSCodeWindow(workspacePath: string | undefined): void {
    const appName = vscode.env.appName || "Visual Studio Code";
    const args = workspacePath ? ["-a", appName, workspacePath] : ["-a", appName];
    cp.execFile("open", args, (err) => {
      if (err) {
        this.outputChannel.appendLine(
          `[mac-notif] open failed: ${err.message}`
        );
      }
    });
  }

  private getWorkspacePath(): string | undefined {
    const wsFile = vscode.workspace.workspaceFile;
    if (wsFile && wsFile.scheme === "file") return wsFile.fsPath;
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) return folders[0].uri.fsPath;
    return undefined;
  }

  private cancelAll(sessionId: string, reason: string): void {
    const timer = this.pendingTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.pendingTimers.delete(sessionId);
    }
    this.cancelMacEscalation(sessionId, reason);
    this.activeNotifications.delete(sessionId);
    this.waitingSessions.delete(sessionId);
    // Programmatically dismiss the in-app withProgress notification if visible
    const dismisser = this.inAppDismissers.get(sessionId);
    if (dismisser) {
      this.outputChannel.appendLine(
        `[in-app] dismissing for session ${sessionId} (cancelAll: ${reason})`
      );
      dismisser();
    }
  }

  dispose(): void {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    for (const timer of this.pendingMacTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingMacTimers.clear();
    for (const groupId of this.activeMacNotifGroups.values()) {
      this.dismissActiveMacNotif(groupId);
    }
    this.activeMacNotifGroups.clear();
    // Dismiss any visible in-app notifications first so withProgress promises resolve
    for (const dismisser of this.inAppDismissers.values()) {
      dismisser();
    }
    this.inAppDismissers.clear();
    this.waitingSessions.clear();
    this.activeNotifications.clear();
    this._alreadyNotified.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.outputChannel.dispose();
  }
}

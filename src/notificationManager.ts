import * as vscode from "vscode";
import type { SessionState } from "./types.js";
import type { TerminalManager } from "./terminalManager.js";

export class NotificationManager {
  private terminalManager: TerminalManager;
  // Pending notification timers per session — cancelled if state changes or terminal focused
  private pendingTimers = new Map<string, NodeJS.Timeout>();
  // Track which sessions have a visible notification so we can ignore stale clicks
  private activeNotifications = new Set<string>();
  private disposables: vscode.Disposable[] = [];

  constructor(terminalManager: TerminalManager) {
    this.terminalManager = terminalManager;
  }

  start(): void {
    // Cancel pending notifications when user manually switches to a Claude terminal
    this.disposables.push(
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        if (!terminal) return;
        // Find which session this terminal belongs to
        for (const [sessionId, tracked] of this.terminalManager.getAllSessions()) {
          if (tracked.terminal === terminal) {
            this.cancelPending(sessionId);
            // Mark notification as stale so clicks are ignored
            this.activeNotifications.delete(sessionId);
            break;
          }
        }
      })
    );
  }

  /** Called on every state change. Schedules or cancels notifications. */
  handleStateChange(state: SessionState): void {
    if (state.state === "waiting") {
      this.scheduleNotification(state);
    } else {
      // State changed to "working" — cancel any pending notification
      this.cancelPending(state.session_id);
      this.activeNotifications.delete(state.session_id);
    }
  }

  private scheduleNotification(state: SessionState): void {
    const config = vscode.workspace.getConfiguration("claudeTerminalStatus");
    if (!config.get<boolean>("showNotifications", true)) return;

    // Cancel any existing timer for this session (reset the clock)
    this.cancelPending(state.session_id);

    const delaySeconds = config.get<number>("notificationDelaySeconds", 60);
    const delayMs = delaySeconds * 1000;

    const timer = setTimeout(() => {
      this.pendingTimers.delete(state.session_id);
      this.showNotification(state, delaySeconds);
    }, delayMs);

    this.pendingTimers.set(state.session_id, timer);
  }

  private async showNotification(state: SessionState, delaySeconds: number): Promise<void> {
    const terminal = this.terminalManager.getTerminalForSession(state.session_id);

    // Don't notify if the terminal is already focused
    if (terminal && vscode.window.activeTerminal === terminal) return;

    const timeLabel = delaySeconds >= 60
      ? `${Math.round(delaySeconds / 60)} minute${Math.round(delaySeconds / 60) > 1 ? "s" : ""}`
      : `${delaySeconds} second${delaySeconds !== 1 ? "s" : ""}`;

    // Build message with optional context snippet
    const snippet = state.last_message
      ? `: "${state.last_message.slice(0, 100)}${state.last_message.length > 100 ? "..." : ""}"`
      : "";

    const message = delaySeconds === 0
      ? `Claude [${state.tag}] needs your attention${snippet}`
      : `Claude [${state.tag}] waiting${snippet}`;

    // Mark this notification as active
    this.activeNotifications.add(state.session_id);

    const action = await vscode.window.showInformationMessage(
      message,
      "Focus Terminal",
      "Quick Reply"
    );

    // If notification was dismissed (user switched to terminal manually), ignore the click
    if (!this.activeNotifications.has(state.session_id)) return;
    this.activeNotifications.delete(state.session_id);

    if (!terminal) return;

    if (action === "Focus Terminal") {
      terminal.show();
    } else if (action === "Quick Reply") {
      const reply = await vscode.window.showInputBox({
        prompt: `Reply to Claude [${state.tag}]`,
        placeHolder: "Type your response (e.g. yes, no, continue...)",
      });
      if (reply !== undefined && reply !== "") {
        terminal.sendText(reply);
      }
    }
  }

  private cancelPending(sessionId: string): void {
    const timer = this.pendingTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.pendingTimers.delete(sessionId);
    }
  }

  dispose(): void {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.activeNotifications.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

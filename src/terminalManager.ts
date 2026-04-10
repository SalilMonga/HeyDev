import * as vscode from "vscode";
import type { SessionState, TrackedTerminal } from "./types.js";

export type TerminalClosedCallback = (sessionId: string) => void;

export class TerminalManager {
  // Map shell PID -> VS Code terminal
  private pidToTerminal = new Map<number, vscode.Terminal>();
  // Map session_id -> tracked terminal info
  private sessionToTerminal = new Map<string, TrackedTerminal>();
  private disposables: vscode.Disposable[] = [];
  private statusBarItem: vscode.StatusBarItem;
  private onTerminalClosedCallbacks: TerminalClosedCallback[] = [];

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      10
    );
  }

  start(): void {
    // Track existing terminals
    for (const terminal of vscode.window.terminals) {
      this.trackTerminal(terminal);
    }

    // Track new terminals
    this.disposables.push(
      vscode.window.onDidOpenTerminal((terminal) => {
        this.trackTerminal(terminal);
      })
    );

    // Clean up closed terminals
    this.disposables.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        this.untrackTerminal(terminal);
      })
    );

    // Update status bar on terminal focus change
    this.disposables.push(
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        this.updateStatusBar(terminal);
      })
    );
  }

  private trackTerminal(terminal: vscode.Terminal): void {
    terminal.processId.then((pid) => {
      if (pid) {
        this.pidToTerminal.set(pid, terminal);
      }
    });
  }

  private untrackTerminal(terminal: vscode.Terminal): void {
    // Remove from PID map
    for (const [pid, t] of this.pidToTerminal) {
      if (t === terminal) {
        this.pidToTerminal.delete(pid);
        break;
      }
    }

    // Remove from session map and notify listeners
    for (const [sessionId, tracked] of this.sessionToTerminal) {
      if (tracked.terminal === terminal) {
        this.sessionToTerminal.delete(sessionId);
        for (const cb of this.onTerminalClosedCallbacks) {
          cb(sessionId);
        }
        break;
      }
    }

    this.updateStatusBar(vscode.window.activeTerminal);
  }

  updateSession(state: SessionState): void {
    // Find the terminal by matching shell PID
    const terminal = this.pidToTerminal.get(state.shell_pid);

    if (terminal) {
      this.sessionToTerminal.set(state.session_id, {
        terminal,
        shellPid: state.shell_pid,
        sessionId: state.session_id,
        currentState: state.state,
        tag: state.tag,
      });

      // Update status bar if this is the active terminal
      if (vscode.window.activeTerminal === terminal) {
        this.updateStatusBar(terminal);
      }
    }
  }

  getTerminalForSession(sessionId: string): vscode.Terminal | undefined {
    return this.sessionToTerminal.get(sessionId)?.terminal;
  }

  getSessionState(sessionId: string): TrackedTerminal | undefined {
    return this.sessionToTerminal.get(sessionId);
  }

  getAllSessions(): Map<string, TrackedTerminal> {
    return this.sessionToTerminal;
  }

  onTerminalClosed(callback: TerminalClosedCallback): void {
    this.onTerminalClosedCallbacks.push(callback);
  }

  private updateStatusBar(terminal: vscode.Terminal | undefined): void {
    if (!terminal) {
      this.statusBarItem.hide();
      return;
    }

    // Find session for this terminal
    for (const tracked of this.sessionToTerminal.values()) {
      if (tracked.terminal === terminal) {
        const icon = tracked.currentState === "working" ? "$(zap)" : "$(eye)";
        const stateText = tracked.currentState === "working" ? "Working" : "Waiting";
        this.statusBarItem.text = `${icon} [${tracked.tag}] ${stateText}`;
        this.statusBarItem.tooltip = `Session ${tracked.tag} is ${stateText.toLowerCase()}`;
        this.statusBarItem.show();
        return;
      }
    }

    // No Claude session for this terminal
    this.statusBarItem.hide();
  }

  dispose(): void {
    this.statusBarItem.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

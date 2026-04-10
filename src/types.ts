export interface SessionState {
  session_id: string;
  tag: string;
  state: "working" | "waiting";
  timestamp: number;
  shell_pid: number;
  last_message?: string;
}

export interface TrackedTerminal {
  terminal: import("vscode").Terminal;
  shellPid: number;
  sessionId: string | undefined;
  currentState: "working" | "waiting" | "unknown";
  tag: string | undefined;
}

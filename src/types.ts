export interface SessionState {
  session_id: string;
  tag: string;
  state: "working" | "waiting";
  timestamp: number;
  shell_pid: number;
  last_message?: string;
  tool?: string;
}

export interface TrackedTerminal {
  terminal: import("vscode").Terminal;
  shellPid: number;
  sessionId: string | undefined;
  currentState: "working" | "waiting" | "unknown";
  tag: string | undefined;
  tool: string | undefined;
}

/** Check if a process is still alive (signal 0 = existence check). */
export function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import type { SessionState } from "./types.js";

export class SessionWatcher extends EventEmitter {
  private stateDir: string;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(stateDir: string) {
    super();
    this.stateDir = stateDir;
  }

  start(): void {
    // Ensure directory exists
    fs.mkdirSync(this.stateDir, { recursive: true });

    // Read existing state files on startup
    this.readExistingStates();

    // Watch for changes
    this.watcher = fs.watch(this.stateDir, (eventType, filename) => {
      if (!filename || !filename.endsWith(".json")) return;

      // Debounce: macOS FSEvents can fire multiple times per write
      const existing = this.debounceTimers.get(filename);
      if (existing) clearTimeout(existing);

      this.debounceTimers.set(
        filename,
        setTimeout(() => {
          this.debounceTimers.delete(filename);
          this.readStateFile(filename);
        }, 50)
      );
    });
  }

  private readExistingStates(): void {
    try {
      const files = fs.readdirSync(this.stateDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        this.readStateFile(file);
      }
    } catch {
      // Directory might not have any files yet
    }
  }

  private readStateFile(filename: string): void {
    const filePath = path.join(this.stateDir, filename);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const state: SessionState = JSON.parse(content);

      // Skip stale files (older than 24 hours)
      const ageMs = Date.now() - state.timestamp * 1000;
      if (ageMs > 24 * 60 * 60 * 1000) {
        this.cleanupFile(filePath);
        return;
      }

      this.emit("stateChange", state);
    } catch {
      // File might be partially written or already deleted
    }
  }

  removeSessionFile(sessionId: string): void {
    const filePath = path.join(this.stateDir, `${sessionId}.json`);
    this.cleanupFile(filePath);
  }

  private cleanupFile(filePath: string): void {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Already deleted
    }
  }

  cleanupStaleFiles(): void {
    try {
      const files = fs.readdirSync(this.stateDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const filePath = path.join(this.stateDir, file);
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const state: SessionState = JSON.parse(content);
          const ageMs = Date.now() - state.timestamp * 1000;
          if (ageMs > 24 * 60 * 60 * 1000) {
            this.cleanupFile(filePath);
          }
        } catch {
          // Remove unparseable files
          this.cleanupFile(filePath);
        }
      }
    } catch {
      // Directory might not exist
    }
  }

  dispose(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}

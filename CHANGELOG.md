# Changelog

All notable changes to HeyDev will be documented in this file.

## [0.3.4] - 2026-04-20

### Added
- **OpenAI Codex CLI support** — HeyDev now works with both Claude Code and Codex CLI out of the box
- Tool-agnostic hook script — terminal tabs show tool name (e.g., "Codex [a1b2] - Working")
- Auto-detection — setup command detects installed tools and configures hooks for each
- Codex `terminal_title` auto-disabled in config.toml (prevents TUI from overwriting tab titles)
- `CODEX_HOME` env var support for custom Codex config locations
- Robust PID walk-up — finds terminal shell PID across any process depth (Claude, Codex, future tools)

### Changed
- **All HeyDev files moved to `~/.heydev/`** — tool-neutral location instead of `~/.claude/`
- Auto-migration of state files from old `~/.claude/terminal-status/` path
- Setup notification redesigned — clean one-line message with "View Details" (Output Channel) and "Open Settings" buttons
- "Already configured" message now a clean single line
- Command palette renamed: "Setup AI CLI Integration (Claude, Codex)" and "Remove All Hooks (Claude, Codex)"
- Uninstall cleans both old (`~/.claude/scripts/`) and new (`~/.heydev/`) hook locations

## [0.3.3] - 2026-04-19

### Fixed
- **Cross-instance notification spillover** — notifications now only fire for sessions owned by the current VS Code window, not all instances watching the shared state directory
- **Startup notification flood** — opening a terminal after a while no longer triggers dozens of stale notifications; existing state files are consumed silently on startup
- **Ghost session cleanup** — state files from dead processes (closed terminals, crashed sessions) are now detected via PID liveness checks and cleaned up automatically

### Added
- `isProcessAlive()` utility — uses `process.kill(pid, 0)` signal check to verify session processes are still running
- PID liveness checks at three points: startup cleanup, file read, and notification scheduling

## [0.2.1] - 2026-04-10

### Fixed
- Hook script escaping — bundled as a file instead of JS string literal
- Terminal titles now work correctly on fresh installs
- Notifications cancelled when terminal is closed (no more stale notifications)

### Changed
- Setup command reads hook script from extension bundle (zero escaping issues)

## [0.2.0] - 2026-04-10

### Added
- **One-command setup**: `Cmd+Shift+P` → "HeyDev: Setup Claude Code Integration" auto-configures everything
- **Remove hooks command**: "HeyDev: Remove Hooks from Claude Code" for clean uninstall
- **First-launch prompt**: Prompts new users to run setup on first activation
- **Claude CLI detection**: Checks if Claude is installed, prompts for path if not found globally
- **CI/CD**: GitHub Action auto-publishes to marketplace on version tags
- **Branch protection**: Main branch requires PR + approval

### Changed
- Simplified README — setup is now 3 steps instead of manual config
- Hook script renamed from `claude-hook-state.sh` to `heydev-hook.sh`

## [0.1.0] - 2026-04-09

### Added
- **Terminal tab status**: Shows ⚡ Working / 👀 Waiting with unique 4-char session tags
- **Smart notifications**: VS Code notifications after configurable delay (default 60s)
- **Quick Reply**: Respond to AI directly from the notification without switching terminals
- **Last message snippet**: Notification shows what the AI is asking
- **Focus Terminal button**: Click notification to jump to the right terminal
- **Notification auto-cancel**: Cancelled when you focus the terminal or AI starts working
- **One-notification-per-wait**: No duplicate notifications per waiting period
- **Status bar indicator**: Shows current session state for focused terminal
- **Customizable emojis**: Change working/waiting emojis via settings
- **Configurable delay**: Set notification timing (0 = immediate)
- **PID-based terminal matching**: Maps sessions to correct VS Code terminals
- **Stale file cleanup**: Removes state files older than 24 hours
- **`CLAUDE_CODE_DISABLE_TERMINAL_TITLE`**: Prevents Claude from overwriting custom titles

### Initial Architecture
- Hook script writes state files to `~/.claude/terminal-status/`
- Extension watches directory with `fs.watch`
- File-based communication between Claude Code hooks and VS Code extension

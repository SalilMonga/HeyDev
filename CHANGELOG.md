# Changelog

All notable changes to HeyDev will be documented in this file.

## [0.5.0] - 2026-05-12

### Added
- **macOS notification escalation** ships as a full feature. When the in-app notification is not interacted with, HeyDev fires a native macOS notification after a configurable delay. Clicking the macOS notification foregrounds VS Code and focuses the originating session terminal — useful for users running multiple VS Code windows.
- **In-app notification now has inline Focus Terminal and Quick Reply links** that are real clickable commands. The pattern uses `withProgress` with `command:` URI markdown links, giving programmatic dismissal (the macOS notification click cleanly dismisses the in-app popup) while preserving multiple actions.
- New command `HeyDev: Focus Waiting Session Terminal` (`heydev.focusSession`). Picks a waiting session and focuses its terminal.
- New command `HeyDev: Quick Reply to Waiting Session` (`heydev.quickReply`). Opens an input box for the user to send a quick reply to a waiting session. Works from the command palette and from the in-app notification link.
- New command `HeyDev: Open Settings` (`heydev.openSettings`) — closes #21.
- New configuration: `heydev.enableMacNotifications`, `heydev.macNotificationDelaySeconds`, `heydev.macNotificationSound`.
- Diagnostic logging in the HeyDev Output Channel covering the full notification lifecycle (state arrivals, in-app scheduled/firing/suppressed/dismissed, mac scheduled/fired/click).

### Changed
- macOS notification timeout extended to 180 seconds so the user has time to click before terminal-notifier auto-dismisses.
- The in-app notification migrated from `showInformationMessage` to `withProgress` to gain programmatic dismissal.

### Fixed
- macOS notification reliability — fired via direct `child_process.spawn` with `detached: true` so terminal-notifier escapes the extension host's process group (the default node-notifier spawn was being suppressed on macOS by hardened-runtime entitlements).
- Notifications could be incorrectly suppressed across waiting cycles — removed a redundant `alreadyNotified.add` in the active-terminal listener that was being re-triggered by macOS Space restoration.

### Known issues
- macOS notification icon shows Terminal.app icon instead of HeyDev's icon. The bundled terminal-notifier's `-appIcon` flag relies on a private macOS method that is silently ignored on recent macOS versions. Tracked as a follow-up — likely requires forking terminal-notifier with HeyDev's icon baked into the bundle.

## [0.4.4] - 2026-05-12

### Fixed
- macOS notification not appearing despite the extension's fire path completing successfully. node-notifier's default spawn keeps terminal-notifier attached to the extension host's process group, and VS Code's hardened-runtime extension host appears to suppress notification UI from attached children. Switched to direct `child_process.spawn` with `detached: true` so terminal-notifier runs in its own process group.

### Added
- Mac notification click now both foregrounds VS Code and calls `terminal.show()` on the target session — equivalent to clicking the in-app "Focus Terminal" button.
- Click detection handles `@CONTENTCLICKED` and `@ACTIONCLICKED` (terminal-notifier on macOS 15 emits the latter for body clicks).

### Known issues
- The in-app `showInformationMessage` popup stays visible as a stale visual after the mac notification is clicked. VS Code does not expose programmatic per-notification dismissal. Future work: redesign the in-app UX. **(Fixed in unreleased V2 above.)**

## [0.4.3] - 2026-05-12

### Added
- Aggressive tracing of `alreadyNotified` set mutations for debugging notification flow.

## [0.4.2] - 2026-05-12

### Fixed
- Notifications could be incorrectly suppressed across waiting cycles. The `onDidChangeActiveTerminal` listener used to add the session to `alreadyNotified`, but macOS Space restoration re-fires this event when returning to VS Code, blocking the next legitimate notification cycle. Removed the redundant flag set — the existing `activeTerminal` guard at fire time still handles the "user is currently looking at the terminal" case.

### Added
- Logging for terminal focus events in the HeyDev Output Channel.

## [0.4.1] - 2026-05-12

### Added
- Diagnostic logging in the HeyDev Output Channel for the full notification lifecycle: state arrivals, in-app scheduled/firing/suppressed/skipped, mac scheduled/fired/cancelled/click. Makes debugging notification behavior easy.

## [0.4.0] - 2026-05-12

### Added
- **macOS notification escalation** — if the in-app notification is not interacted with within a configurable delay, HeyDev now fires a native macOS notification. Clicking the notification focuses the originating VS Code window so you land on the correct workspace, even when running multiple VS Code instances.
- New configuration settings:
  - `heydev.enableMacNotifications` (default `true`) — toggle macOS escalation
  - `heydev.macNotificationDelaySeconds` (default `30`) — seconds to wait after the in-app notification before escalating
  - `heydev.macNotificationSound` (default `false`) — play sound when the macOS notification fires
- `node-notifier` runtime dependency — bundles `terminal-notifier.app`, no system install required.

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

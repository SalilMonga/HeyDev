# Changelog

All notable changes to HeyDev will be documented in this file.

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

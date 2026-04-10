# Contributing to HeyDev

Thanks for your interest in contributing! HeyDev is a small, focused project and contributions of all sizes are welcome.

## Quick Start

```bash
git clone https://github.com/SalilMonga/HeyDev.git
cd HeyDev
npm install
npm run compile
```

To test locally:
```bash
npx @vscode/vsce package --allow-missing-repository
code --install-extension heydev-0.1.0.vsix --force
# Then Cmd+Shift+P → "Reload Window"
```

## Project Structure

```
src/
  extension.ts          # Entry point — wires everything together
  sessionWatcher.ts     # Watches ~/.claude/terminal-status/ for state files
  terminalManager.ts    # Maps sessions to VS Code terminals via PID
  notificationManager.ts # Smart notifications with Focus Terminal + Quick Reply
  types.ts              # Shared interfaces
```

## How It Works

1. Claude Code hooks write JSON state files to `~/.claude/terminal-status/`
2. The extension watches that directory with `fs.watch`
3. PID matching maps state files to VS Code terminal instances
4. Notifications fire after a configurable delay

## Adding Support for a New AI CLI

This is the most impactful contribution! To add support for a new tool:

1. **Research** the tool's hook/plugin/extension system
2. **Write a hook script** that writes HeyDev state files in this format:

```json
{
  "session_id": "unique-session-id",
  "tag": "4chr",
  "state": "working|waiting",
  "timestamp": 1712678400,
  "shell_pid": 12345,
  "last_message": "Optional snippet of last AI message"
}
```

3. **Write setup instructions** for the tool
4. **Submit a PR** with the script and docs

See the Claude Code hook script at `~/.claude/scripts/claude-hook-state.sh` for reference.

## Guidelines

- Keep it simple — this is a small utility, not a framework
- Test on macOS at minimum (Linux/Windows testing appreciated)
- Update the README if you change settings or add features
- One PR per feature/fix

## Issues

Check the [issue tracker](https://github.com/SalilMonga/HeyDev/issues) for open tasks. Issues labeled `good first issue` are great starting points.

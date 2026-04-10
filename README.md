# HeyDev

> Hey dev, your AI is waiting for you.

A VS Code extension that shows real-time status indicators for AI CLI sessions (like Claude Code) in your terminal tabs, with smart notifications that bring you back when the AI is waiting for input.

## The Problem

When running multiple AI CLI sessions in VS Code, you constantly switch between terminals to check if the agent is done working or waiting for your input. There's no visual indicator in the terminal tab, and no way to know which session needs attention.

## The Solution

HeyDev adds live status indicators to your terminal tabs and sends smart VS Code notifications when your AI agent has been waiting for you.

## Features

### Terminal Tab Status

Each AI terminal tab shows its current state with a unique session tag:

![Terminal tabs showing Working and Waiting states](images/screenshot-tabs.png)

- **⚡ Claude [a1b2] - Working** — The AI agent is actively using tools
- **👀 Claude [a1b2] - Waiting** — The AI agent is waiting for your input

The 4-character tag (`a1b2`) uniquely identifies each session, so you can tell multiple terminals apart at a glance.

### Smart Notifications

When the AI agent has been waiting for your input, a VS Code notification appears with context about what it's asking:

![Notification with Focus Terminal and Quick Reply buttons](images/screenshot-notification.png)

- **Focus Terminal** — Instantly switches to the correct terminal
- **Quick Reply** — Opens an input box to send a response (e.g., "yes", "no", "continue") without switching terminals

Notifications are smart:
- Show a snippet of the AI's last message so you know what it's asking
- Only fire after a configurable delay (default: 60 seconds)
- Cancelled if the AI starts working again before the delay
- Cancelled if you manually switch to the terminal
- Suppressed if the terminal is already focused

### Configurable Settings

Customize emojis, notification timing, and more:

![Extension settings](images/screenshot-settings.png)

### Status Bar

The VS Code status bar shows the state of the currently focused AI terminal session.

## Supported Tools

- **Claude Code** — Fully supported today via hooks
- **Codex, Copilot, Aider** — Planned for future releases

## Installation

### From VSIX (Local)

```bash
cd claude-terminal-status
npm install
npm run compile
npx @vscode/vsce package --allow-missing-repository
code --install-extension heydev-0.1.0.vsix
```

### Prerequisites

1. **Claude Code CLI** installed and configured
2. **jq** installed (`brew install jq` on macOS)
3. **Hook script** and **hooks** configured (see Setup below)

## Setup

### 1. Install the hook script

Copy the hook helper script:

```bash
mkdir -p ~/.claude/scripts
cat > ~/.claude/scripts/claude-hook-state.sh << 'EOF'
#!/bin/bash
STATE="$1"
INPUT=$(cat)
SID=$(echo "$INPUT" | jq -r '.session_id')
TAG=$(echo "$SID" | cut -c1-4)
SHELL_PID=$(ps -o ppid= -p $PPID 2>/dev/null | tr -d ' ')

CONFIG_FILE="$HOME/.claude/terminal-status/emoji-config.json"
if [ -f "$CONFIG_FILE" ]; then
  WORKING_EMOJI=$(jq -r '.workingEmoji // "⚡"' "$CONFIG_FILE")
  WAITING_EMOJI=$(jq -r '.waitingEmoji // "👀"' "$CONFIG_FILE")
else
  WORKING_EMOJI="⚡"
  WAITING_EMOJI="👀"
fi

STATE_DIR="$HOME/.claude/terminal-status"
mkdir -p "$STATE_DIR"
echo "{\"session_id\":\"$SID\",\"tag\":\"$TAG\",\"state\":\"$STATE\",\"timestamp\":$(date +%s),\"shell_pid\":${SHELL_PID:-0}}" > "$STATE_DIR/$SID.json"

if [ "$STATE" = "working" ]; then
  printf "\033]0;$WORKING_EMOJI Claude [$TAG] - Working\007" > /dev/tty
else
  printf "\033]0;$WAITING_EMOJI Claude [$TAG] - Waiting\007" > /dev/tty
fi
EOF
chmod +x ~/.claude/scripts/claude-hook-state.sh
```

### 2. Add hooks to Claude Code settings

Add these hooks to your `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_DISABLE_TERMINAL_TITLE": "1"
  },
  "hooks": {
    "Notification": [
      {
        "matcher": "idle_prompt|permission_prompt|elicitation_dialog",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/scripts/claude-hook-state.sh waiting",
            "async": true
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/scripts/claude-hook-state.sh working",
            "async": true
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/scripts/claude-hook-state.sh working",
            "async": true
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/scripts/claude-hook-state.sh working",
            "async": true
          }
        ]
      }
    ]
  }
}
```

### 3. Disable Claude's built-in title management

The `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` environment variable (included in the config above) prevents Claude Code from overwriting the custom terminal titles.

### 4. Reload VS Code

Press `Cmd+Shift+P` → "Reload Window" to activate the extension.

## Settings

Configure via VS Code Settings (`Cmd+,`) → search "HeyDev":

| Setting | Default | Description |
|---------|---------|-------------|
| `heydev.showNotifications` | `true` | Enable/disable VS Code notifications |
| `heydev.notificationDelaySeconds` | `60` | Seconds to wait before notifying (0 = immediate) |
| `heydev.workingEmoji` | `⚡` | Emoji for the "working" state in terminal tabs |
| `heydev.waitingEmoji` | `👀` | Emoji for the "waiting" state in terminal tabs |
| `heydev.stateDirectory` | *(auto)* | Override state file directory |

Emoji changes sync automatically to the hook script — no manual editing needed.

## How It Works

```
AI CLI (e.g. Claude Code)
  ↓ (hooks fire on state changes)
Hook Script (~/.claude/scripts/claude-hook-state.sh)
  ↓ writes state file          ↓ sets terminal title
  ~/.claude/terminal-status/    Terminal tab: ⚡ Claude [a1b2] - Working
  ↓ (fs.watch)
VS Code Extension (HeyDev)
  ↓ maps session → terminal via PID
  ↓ sends notifications
  VS Code notification: "[a1b2] has been waiting for 1 minute"
    → [Focus Terminal] [Quick Reply]
```

1. **Hooks** fire on AI CLI events (tool use, stop, user prompt)
2. **Hook script** writes a JSON state file and sets the terminal title
3. **HeyDev extension** watches the state directory for changes
4. **PID matching** maps each state file to the correct VS Code terminal
5. **Notifications** appear after the configured delay with actions to focus or quick-reply

## Compatibility

- **VS Code** 1.85+
- **macOS** (tested), Linux (should work), Windows (untested)
- **Claude Code CLI** with hooks support
- **Terminal**: Works in VS Code's integrated terminal

## License

MIT

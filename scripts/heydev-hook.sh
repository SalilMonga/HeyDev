#!/bin/bash
# HeyDev hook script — writes state files for the VS Code extension
# Usage: heydev-hook.sh <working|waiting>

STATE="$1"
INPUT=$(cat)
SID=$(echo "$INPUT" | jq -r '.session_id')
TAG=$(echo "$SID" | cut -c1-4)

# Get the shell PID (terminal shell -> claude -> hook shell)
SHELL_PID=$(ps -o ppid= -p $PPID 2>/dev/null | tr -d ' ')

# Extract last assistant message (truncate to 150 chars, escape for JSON)
LAST_MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // empty' | head -c 150 | tr '\n' ' ' | sed 's/"/\\"/g')

# Read custom emojis from config
CONFIG_FILE="$HOME/.claude/terminal-status/emoji-config.json"
if [ -f "$CONFIG_FILE" ]; then
  WORKING_EMOJI=$(jq -r '.workingEmoji // "⚡"' "$CONFIG_FILE")
  WAITING_EMOJI=$(jq -r '.waitingEmoji // "👀"' "$CONFIG_FILE")
else
  WORKING_EMOJI="⚡"
  WAITING_EMOJI="👀"
fi

# Write state file for the VS Code extension
STATE_DIR="$HOME/.claude/terminal-status"
mkdir -p "$STATE_DIR"
echo "{\"session_id\":\"$SID\",\"tag\":\"$TAG\",\"state\":\"$STATE\",\"timestamp\":$(date +%s),\"shell_pid\":${SHELL_PID:-0},\"last_message\":\"$LAST_MSG\"}" > "$STATE_DIR/$SID.json"

# Set terminal title via escape sequence
if [ "$STATE" = "working" ]; then
  printf "\033]0;$WORKING_EMOJI Claude [$TAG] - Working\007" > /dev/tty
else
  printf "\033]0;$WAITING_EMOJI Claude [$TAG] - Waiting\007" > /dev/tty
fi

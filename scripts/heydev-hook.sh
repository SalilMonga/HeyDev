#!/bin/bash
# HeyDev hook script — writes state files for the VS Code extension
# Usage: heydev-hook.sh <working|waiting> [tool-name]
# tool-name defaults to "Claude" if not provided

STATE="$1"
TOOL="${2:-Claude}"
INPUT=$(cat)

# Extract session ID — try session_id first (Claude), fall back to thread_id (Codex)
SID=$(echo "$INPUT" | jq -r '.session_id // .thread_id // empty')
if [ -z "$SID" ]; then
  # Generate a deterministic ID from shell PID if no session ID available
  SID="heydev-$$"
fi
TAG=$(echo "$SID" | cut -c1-4)

# Find terminal shell PID by walking up process tree
# Walk all the way up, pick the LAST shell encountered before init/IDE process
# Claude: hook → claude → zsh
# Codex:  hook → codex → node → zsh
CURRENT_PID=$$
SHELL_PID=0
for i in 1 2 3 4 5 6 7 8; do
  PARENT=$(ps -o ppid= -p $CURRENT_PID 2>/dev/null | tr -d ' ')
  [ -z "$PARENT" ] || [ "$PARENT" = "1" ] && break
  PNAME=$(ps -o comm= -p $PARENT 2>/dev/null)
  PNAME=$(basename "$PNAME" 2>/dev/null | tr -d ' ')
  case "$PNAME" in
    zsh|bash|fish|sh|dash|tcsh|ksh|-zsh|-bash)
      SHELL_PID=$PARENT
      ;;
  esac
  CURRENT_PID=$PARENT
done
# Fallback: original 2-hop behavior
if [ "$SHELL_PID" = "0" ]; then
  SHELL_PID=$(ps -o ppid= -p $PPID 2>/dev/null | tr -d ' ')
fi

# Extract last assistant message (truncate to 150 chars, escape for JSON)
LAST_MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // .last_assistant_message // empty' | head -c 150 | tr '\n' ' ' | sed 's/"/\\"/g')

# Read custom emojis from config
CONFIG_FILE="$HOME/.heydev/emoji-config.json"
if [ -f "$CONFIG_FILE" ]; then
  WORKING_EMOJI=$(jq -r '.workingEmoji // "⚡"' "$CONFIG_FILE")
  WAITING_EMOJI=$(jq -r '.waitingEmoji // "👀"' "$CONFIG_FILE")
else
  WORKING_EMOJI="⚡"
  WAITING_EMOJI="👀"
fi

# Write state file for the VS Code extension
STATE_DIR="$HOME/.heydev/state"
mkdir -p "$STATE_DIR"
echo "{\"session_id\":\"$SID\",\"tag\":\"$TAG\",\"state\":\"$STATE\",\"timestamp\":$(date +%s),\"shell_pid\":${SHELL_PID:-0},\"last_message\":\"$LAST_MSG\",\"tool\":\"$TOOL\"}" > "$STATE_DIR/$SID.json"

# Set terminal title via escape sequence
if [ "$STATE" = "working" ]; then
  printf "\033]0;$WORKING_EMOJI $TOOL [$TAG] - Working\007" > /dev/tty
else
  printf "\033]0;$WAITING_EMOJI $TOOL [$TAG] - Waiting\007" > /dev/tty
fi

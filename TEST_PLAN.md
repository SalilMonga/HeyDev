# Claude Terminal Status - Test Plan

## Core Functionality

- [ ] Terminal title shows "⚡ Claude [xxxx] - Working" when Claude is using tools
- [ ] Terminal title shows "👀 Claude [xxxx] - Waiting" when Claude is idle
- [ ] Title updates on UserPromptSubmit (typing a message)
- [ ] Multiple terminals show different session IDs (4-char tags)
- [ ] New Claude sessions get picked up automatically
- [ ] Closing a terminal cleans up tracking

## Notifications

- [ ] Notification appears after 1 minute of waiting (default delay)
- [ ] Notification is suppressed if Claude starts working before delay
- [ ] Notification is suppressed if the terminal is already focused
- [ ] "Focus Terminal" button switches to the correct terminal
- [ ] "Quick Reply" opens input box and sends text to correct terminal
- [ ] Quick Reply with empty input does nothing
- [ ] No duplicate notifications during cooldown
- [ ] Pending notification cancelled when manually switching to that terminal
- [ ] Already-shown notification ignored if user already switched to terminal
- [ ] "Quick Reply" sends text to correct terminal without focusing it

## Settings

- [ ] `showNotifications: false` disables notifications entirely
- [ ] `notificationDelaySeconds: 0` sends notification immediately
- [ ] `notificationDelaySeconds: 10` sends notification after 10s (test with short delay)
- [ ] `workingEmoji` change reflects in terminal title
- [ ] `waitingEmoji` change reflects in terminal title
- [ ] Changing settings takes effect without restarting VS Code (just reload window)

## Status Bar

- [ ] Status bar shows state when a Claude terminal is focused
- [ ] Status bar hides when a non-Claude terminal is focused
- [ ] Status bar updates when switching between Claude terminals

## Edge Cases

- [ ] Extension activates on VS Code startup (onStartupFinished)
- [ ] Extension handles Claude session started before extension activated
- [ ] Stale state files (>24h) are cleaned up on activation
- [ ] `--resume` sessions get tracked after restart
- [ ] Hook script handles missing `jq` gracefully
- [ ] Multiple VS Code windows don't cross-notify (PID isolation)

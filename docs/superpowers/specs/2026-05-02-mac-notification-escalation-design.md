# macOS Notification Escalation — Design Spec

**Date:** 2026-05-02
**Author:** Salil Monga
**Status:** Approved (pending implementation)

## Problem

HeyDev currently fires an in-app `showInformationMessage` notification when an AI CLI session enters the `waiting` state. The user runs multiple VS Code windows. If the waiting session is in window A and the user is currently focused on window B, the in-app popup appears only on window A and is easily missed.

## Goal

Escalate to a native macOS notification when the in-app popup is not interacted with within a configurable delay. Clicking the macOS notification should focus the specific VS Code window that originated the notification, so the user lands on the correct workspace.

## Scope

- macOS only (v1). Windows and Linux are out of scope; can be added later via `node-notifier` cross-platform backends.
- Two-stage escalation: in-app first (existing), then macOS notification.
- Click on macOS notification focuses the originating VS Code window only. No auto-action (no auto Focus Terminal, no auto Quick Reply).
- Cross-Space focus is acceptable. macOS will switch Spaces if needed; that matches user intent.

### Out of scope (deferred to v2+)

- Detecting whether the entire VS Code app is in foreground vs background. Future iteration: skip in-app entirely if VS Code app is not focused.
- Click → auto Focus Terminal or re-show in-app popup. Future iteration once base flow is stable.
- Cross-platform support (Windows toast, Linux libnotify).
- Custom branding via forked terminal-notifier binary.

## High-level flow

```
state="waiting" arrives
    ↓
schedule in-app timer (existing, default 60s)
    ↓
in-app timer fires → showInformationMessage()
    ↓
schedule mac escalation timer (NEW, default 30s)
    ↓
mac timer fires → check guards → fire node-notifier
    ↓
user clicks → run `open -a "<appName>" <workspacePath>` to focus window
```

## Architecture

### Approach

Extend the existing `NotificationManager` class directly. Reasoning: notification escalation is notification logic. The class already tracks per-session `pendingTimers`, `activeNotifications`, and `alreadyNotified`. Splitting into a separate class would force shared mutable state across two classes and duplicate the terminal-focus and terminal-closed listeners.

### Files touched

- `src/notificationManager.ts` — extended with mac escalation logic.
- `package.json` — add `node-notifier` runtime dep, add three configuration settings.
- `images/icon.png` — reused as macOS notification icon (no new asset needed).
- `.vscodeignore` — verify `node_modules/node-notifier/vendor/` is included in `.vsix` packaging.

### New dependency

```json
"dependencies": {
  "node-notifier": "^10.0.1"
}
```

`node-notifier` bundles `terminal-notifier.app` in its `vendor/` directory. No system install required (e.g. no `brew install terminal-notifier` step).

### New state in NotificationManager

```typescript
private pendingMacTimers = new Map<string, NodeJS.Timeout>();
private activeMacNotifGroups = new Map<string, string>(); // sessionId -> groupId
```

## Behavior

### Cancellation matrix

| Event | Cancel pending mac timer? | Dismiss active mac notif? | Clear `alreadyNotified`? |
|---|---|---|---|
| State → `working` | Yes | Yes | Yes |
| Terminal closed | Yes | Yes | Yes |
| User clicks in-app "Focus Terminal" | Yes | Yes | Keep (mark notified) |
| User clicks in-app "Quick Reply" | Yes | Yes | Keep |
| User dismisses in-app via X | Yes | Yes | Keep — no escalation after explicit dismiss |
| User focuses terminal manually | Yes | Yes | Keep |
| User clicks mac notif | n/a | Mark consumed | Keep |
| Mac notif times out | n/a | Clear handle | Keep |

Dismissing the in-app popup via X is treated as "user saw it and made a choice." We do not pester with mac notif after explicit dismissal.

### Re-notification gating

Same as existing logic: once `alreadyNotified` is set for a session, no further notifications fire (in-app or mac) until the session cycles back through `working`. Identical to current `alreadyNotified` semantics.

### Multiple waiting sessions

Each session gets independent timers and an independent macOS notification with a unique `group` ID equal to the session ID. This prevents collisions and allows targeted dismissal via `terminal-notifier -remove <groupId>`.

### Click handler scoping

`notifier.on("click", ...)` is a global event emitter and would fire for any notification when multiple are active. Use the per-call `notifier.notify(opts, callback)` form instead, which passes metadata for the specific notification. The callback closes over `sessionId` and `workspacePath` so each notification routes to the correct session.

### Click action

```typescript
private focusVSCodeWindow(workspacePath: string | undefined): void {
  const appName = vscode.env.appName; // "Visual Studio Code", "Cursor", etc.
  if (workspacePath) {
    cp.execFile("open", ["-a", appName, workspacePath]);
  } else {
    cp.execFile("open", ["-a", appName]);
  }
}
```

`open -a` was chosen over the `code` CLI because:
- VS Code app is guaranteed installed (the extension is running inside it).
- `code` CLI is a separate install step (`Shell Command: Install 'code' command in PATH`) that many users skip.
- macOS Launch Services dedupes by workspace path and focuses the existing window with that workspace open. No new window is created.
- `vscode.env.appName` handles the Cursor / VS Code Insiders variants automatically.

If testing reveals focus issues (some VS Code GitHub issues report `code` CLI does not always transfer focus), chain with osascript activate as a belt-and-suspenders fallback:

```typescript
cp.execFile("open", ["-a", appName, workspacePath], () => {
  cp.execFile("osascript", ["-e", `tell application "${appName}" to activate`]);
});
```

### Workspace path capture

Capture the workspace path at notification schedule time, not at click time, because the workspace can change before the user clicks.

```typescript
private getWorkspacePath(): string | undefined {
  const wsFile = vscode.workspace.workspaceFile;
  if (wsFile && wsFile.scheme === "file") return wsFile.fsPath;
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) return folders[0].uri.fsPath;
  return undefined;
}
```

If no workspace is open (rare for terminal users), fall back to plain app activation.

### Platform guard

```typescript
if (process.platform !== "darwin") return;
```

Skip mac escalation entirely on Windows and Linux. Document in README.

### Critical finding during implementation: detached spawn required

During testing we discovered that `notifier.notify()` from node-notifier silently fails to display notifications when called from inside the VS Code extension host, even though the same call works from a regular `node` process. Cause: node-notifier's default `child_process.spawn` keeps the spawned terminal-notifier in the extension host's process group, and VS Code's hardened-runtime extension host appears to suppress notification UI from attached child processes.

Fix: bypass `notifier.notify()` and spawn the bundled terminal-notifier binary directly with `child_process.spawn(path, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] })` followed by `child.unref()`. This puts terminal-notifier in its own process group, decoupled from the extension host.

We still read stdout to detect clicks. terminal-notifier emits `@CONTENTCLICKED`, `@ACTIONCLICKED`, `@TIMEOUT`, or `@CLOSED`. Both click variants trigger the focus-window flow.

### node-notifier invocation (legacy reference)

```typescript
notifier.notify({
  title: `[${state.tag}] waiting`,
  message: snippet || "AI session needs your attention",
  icon: path.join(extensionPath, "images", "icon.png"),
  sound: config.get<boolean>("macNotificationSound", false),
  wait: true,
  timeout: 30,
  group: state.session_id,
}, callback);
```

The `icon` option maps to `terminal-notifier`'s `-appIcon` flag, which uses a private macOS API to display a custom icon in the notification. This is documented as "subject to change" by terminal-notifier upstream but works reliably on macOS 13, 14, and 15. If Apple breaks it in a future release, fall back to default icon (functional impact zero).

The `-sender` flag is intentionally NOT used. `-sender` displays the spoofed app's icon but breaks the click callback because terminal-notifier delegates click handling to the spoofed app's launch.

## Configuration

New `package.json` settings:

```json
"heydev.enableMacNotifications": {
  "type": "boolean",
  "default": true,
  "description": "Escalate to a native macOS notification if the in-app notification is not interacted with. macOS only."
},
"heydev.macNotificationDelaySeconds": {
  "type": "number",
  "default": 30,
  "minimum": 5,
  "maximum": 600,
  "description": "Seconds to wait after the in-app notification before showing a macOS notification."
},
"heydev.macNotificationSound": {
  "type": "boolean",
  "default": false,
  "description": "Play sound when the macOS notification fires."
}
```

### Master switch behavior

| `showNotifications` | `enableMacNotifications` | Result |
|---|---|---|
| false | any | No notifications at all |
| true | false | In-app only (current behavior) |
| true | true | In-app + mac escalation |

### Config read timing

Read configuration at fire time via `vscode.workspace.getConfiguration("heydev")`, not in the constructor. This matches the existing pattern in `scheduleNotification` and lets users change configuration without reloading the window.

## Logging

Add to existing Output Channel:

- `[mac-notif] scheduled for session X in 30s`
- `[mac-notif] fired for session X`
- `[mac-notif] cancelled for session X (reason)`
- `[mac-notif] click handler invoked, focusing window at <path>`
- `[mac-notif] node-notifier error: <msg>`

## Failure modes

| Failure | Behavior |
|---|---|
| `node-notifier` vendor binary missing (bad packaging) | Log error, fall through silently. In-app still works. |
| User has disabled HeyDev / VS Code in System Settings → Notifications | OS suppresses silently. No-op. Document in README troubleshooting. |
| macOS Focus / Do Not Disturb mode active | OS suppresses. Expected. |
| Extension reload while notif active | Subprocess survives reload. Click callback dies. User click does nothing. Acceptable degradation. |

Optional polish (not required for v1): on extension activation, fire `terminal-notifier -remove ALL` on our group prefix to clean up orphans from a previous session.

## Test plan

Manual verification only. Real macOS environment required. The extension cannot reliably unit-test native notifications.

### Required scenarios

1. **Happy path:** 2 VS Code windows. Trigger waiting in A, focus B. Wait > 60s + 30s. Mac notif appears. Click → window A focused with correct workspace.
2. **In-app interaction cancels mac:** Trigger waiting, stay focused, in-app fires, click "Focus Terminal" within 30s. Mac notif never fires.
3. **In-app dismiss cancels mac:** In-app fires, click X. Mac notif never fires.
4. **State change cancels mac:** In-app fires, AI returns to working before 30s. Mac timer cancelled.
5. **Multiple sessions:** Two AI CLIs both in waiting. Two distinct mac notifs, each click focuses correct window.
6. **Click missed:** Mac notif fires, ignore for 30s. Auto-dismisses, state cleaned.
7. **Re-notification gating:** Mac notif fires, dismiss. Same session stays waiting. No re-notify. Session cycles to working → waiting again. Re-notify allowed.
8. **Config off:** `enableMacNotifications: false`. Only in-app fires.
9. **Platform guard:** Windows / Linux: only in-app. macOS: both.
10. **Icon verification:** Mac notif shows HeyDev icon, not Terminal icon.

### Packaging verification

```bash
vsce package
unzip -l heydev-X.Y.Z.vsix | grep node-notifier/vendor
# Expect terminal-notifier.app entries present
```

## Known limitations / follow-ups

- **Existing in-app "Focus Terminal" bug:** User reports the existing in-app popup's "Focus Terminal" button works inconsistently. Tracked as a follow-up task. Out of scope for this spec.
- **`-appIcon` ignored on macOS 15+:** During testing the bundled `terminal-notifier` did not honor the `-appIcon` flag — the notification displays the default Terminal.app icon regardless. The `-appIcon` flag relies on a private macOS method that recent macOS versions appear to ignore. Future work: fork terminal-notifier and rebake the .app bundle with HeyDev's icon as the bundle icon, OR investigate alternative notification mechanisms (native UNUserNotificationCenter via a tiny signed helper binary).
- **Click-to-focus verification:** Initial implementation detected only `@CONTENTCLICKED`. terminal-notifier on macOS 15 emits `@ACTIONCLICKED` when the body is clicked. Detection now handles both.
- **Cross-platform escalation:** Windows and Linux escalation deferred to v2.
- **Smart focus detection (originally proposed Plan D):** detect whether the VS Code app is foregrounded. If not focused, skip in-app and go straight to mac notif. Deferred to v2 once base flow is stable.

## Changelog entry

When implemented, add to `CHANGELOG.md`:

```
### Added
- macOS notification escalation: if the in-app notification is not interacted with, fire a native macOS notification after a configurable delay. Clicking the notification focuses the originating VS Code window.
- Configuration: `heydev.enableMacNotifications`, `heydev.macNotificationDelaySeconds`, `heydev.macNotificationSound`.
```

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**agent-electron** is an Electron app automation CLI for AI agents. It provides programmatic control over Electron applications (launch, interact, screenshot, verify) through a command-line interface, designed for the build-and-verify loop.

## Build & Development Commands

```bash
npm run build          # Compile TypeScript (tsc) → dist/
npm run dev            # Watch mode (tsc --watch)
npm run test           # Run E2E tests: node --experimental-vm-modules dist/test/e2e.js
```

Tests require a display server (e.g., `DISPLAY=:99` with Xvfb on Linux). The test suite uses the bundled `test-app/` Electron app. You must build before running tests.

There is no linter configured. E2E tests are in `test/e2e.ts`.

## Architecture

**Client-daemon pattern** over a Unix socket (`~/.agent-electron/daemon.sock`):

1. **CLI** (`src/cli.ts`) — Commander.js command parser. Translates CLI args into typed Command objects.
2. **Client** (`src/client.ts`) — Connects to daemon via Unix socket. Auto-spawns the daemon as a detached forked process on first command. The daemon persists between CLI invocations (no cold start).
3. **Daemon** (`src/daemon.ts`) — Unix socket server. Receives newline-delimited JSON commands, delegates to `executeCommand()`, returns JSON responses. Writes PID to `~/.agent-electron/daemon.pid`.
4. **Actions** (`src/actions.ts`) — Command execution logic. Resolves `@ref` targets to Playwright selectors. Checks if a CDP session is active (webview mode) vs normal Playwright mode.
5. **ElectronManager** (`src/electron-manager.ts`) — Core automation engine. Two modes:
   - **Launch mode**: `_electron.launch()` with optional `--executable-path` for pre-built apps (VS Code, Slack)
   - **Connect mode**: `chromium.connectOverCDP()` to attach to running apps
   - Also handles: window management, frame navigation, CDP target switching (webviews via raw WebSocket), main process eval
6. **Snapshot** (`src/snapshot.ts`) — Generates accessibility tree from Playwright's `ariaSnapshot()` API. Assigns element refs (`e1`, `e2`, ...) mapped to CSS/role selectors. This is how AI agents "see" the UI.
7. **Types** (`src/types.ts`) — All command/response types, error codes, and default timeouts.
8. **Protocol** (`src/protocol.ts`) — Newline-delimited JSON serialization for socket communication.

### Key Patterns

- **Ref system**: `snapshot` assigns refs like `@e1`, `@e2` to UI elements. Interaction commands (`click`, `fill`, etc.) accept `@ref` targets that get resolved to Playwright selectors via the stored RefMap.
- **CDP targets**: For webview iframes (e.g., VS Code extension panels), the manager opens a raw WebSocket CDP connection. When a CDP session is active, `eval`, `snapshot`, `click`, and `fill` operate within that target's context.
- **All commands return structured JSON** with `--json` flag: `{success: true, data: {...}}` or `{success: false, error: "<code>", message: "..."}`.
- **ES modules throughout** — the project uses `"type": "module"` with `.js` extensions in imports.

### Adding a New Command

1. Add the command type interface to `src/types.ts` and include it in the `Command` union
2. Add default timeout in `DEFAULT_TIMEOUTS` in `src/types.ts`
3. Implement execution logic in `src/actions.ts` within `executeCommand()`
4. Add CLI parsing in `src/cli.ts` using Commander

## Connecting to VS Code

VS Code extensions render their UI inside nested webview iframes. Reaching them requires frame navigation. Here is the full recipe (all commands assume `dist/` is built via `npm run build`):

```bash
AE="node dist/src/cli.js"

# 1. Launch VS Code
$AE launch --executable-path "/Applications/Visual Studio Code.app/Contents/MacOS/Electron"

# 2. Take a top-level snapshot to see the main VS Code UI (sidebar, tabs, etc.)
$AE snapshot

# 3. Click the extension's tab to make sure its panel is visible.
#    Find the ref from the snapshot, e.g. tab "Augment" [ref=e81]
$AE click @e81

# 4. List frames to find the extension's webview.
#    Look for the one whose URL contains the extension ID (e.g. extensionId=Augment.vscode-augment).
$AE frame list
#    Example output:
#      0: (main) (vscode-file://...)
#      1: <guid> (vscode-webview://...extensionId=Augment.vscode-augment...&purpose=webviewView)
#      2: pending-frame (vscode-webview://.../fake.html?id=<guid>)

# 5. Switch to the inner frame (the "fake.html" / pending-frame one).
#    This is the frame that actually hosts the extension's rendered HTML.
#    It is typically index 2 (the nested iframe inside the webview host at index 1).
$AE frame switch 2

# 6. Snapshot inside the extension webview to see its UI elements and refs.
$AE snapshot

# 7. Interact — find the input textbox ref from the snapshot and fill + submit.
$AE fill @e53 "hello"
$AE press Enter

# 8. (Optional) Wait a few seconds and snapshot again to read the response.
sleep 5 && $AE snapshot
```

### Key details for VS Code webviews

- **Frame 0** is always the main VS Code workbench.
- **Frame 1** is the webview host (the outer `<webview>` element). Snapshotting it shows only `document > document > iframe` — no useful content.
- **Frame 2** (the `fake.html` / `pending-frame`) is the actual extension content. This is where you snapshot and interact.
- Use `$AE frame reset` to return to the main frame before switching to a different extension's webview.
- After `frame switch 2`, all commands (`snapshot`, `click`, `fill`, `press`, `eval`) operate within that extension's DOM.
- Different extensions will have different frame indices. Always use `frame list` and look for the `extensionId=` in the URL to identify the correct one.
- If the extension has multiple webviews open, there will be additional frame pairs (host + inner) for each one.

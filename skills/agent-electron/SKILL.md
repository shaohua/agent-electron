---
name: agent-electron
description: Electron app automation CLI for AI agents. Use when the user needs to interact with Electron desktop apps (VS Code, Slack, custom apps), including launching apps, navigating UI via accessibility snapshots, clicking buttons, filling inputs, taking screenshots, evaluating JavaScript, or automating extension webviews via CDP. Triggers include requests to "launch an Electron app", "automate VS Code", "click a button in the app", "take a screenshot", "interact with a webview", "test this desktop app", "fill a form in the editor", or any task requiring programmatic Electron app interaction.
allowed-tools: Bash(npx agent-electron:*), Bash(agent-electron:*), Bash(node */agent-electron/dist/src/cli.js:*)
---

# Electron App Automation with agent-electron

## Core Workflow

Every Electron automation follows this pattern:

1. **Launch or Connect**: Start an app or attach to a running one
2. **Snapshot**: `agent-electron snapshot -i` (get element refs like `@e1`, `@e2`)
3. **Interact**: Use refs to click, fill, type
4. **Re-snapshot**: After any UI change, get fresh refs

```bash
# Launch an app
agent-electron launch ./my-app/main.js

# See the UI
agent-electron snapshot -i
# - heading "My App" [ref=e1] [level=1]
# - textbox "Search" [ref=e2]
# - button "Submit" [ref=e3]

# Interact using refs
agent-electron fill @e2 "hello world"
agent-electron click @e3

# Verify
agent-electron eval "document.querySelector('#result').textContent"
agent-electron screenshot verify.png

# Close
agent-electron close
```

## Build-Verify Loop (Recommended for AI Agents)

```bash
# 1. Build the app
npx electron-vite build

# 2. Launch and verify with structured JSON output
agent-electron launch . --json
agent-electron snapshot -i --json          # See the UI
agent-electron fill @e2 "test" --json      # Interact
agent-electron click @e3 --json            # Click
agent-electron wait --text "Success" --json # Wait for result
agent-electron eval "checkState()" --json   # Verify JS state
agent-electron screenshot ./verify.png --json
agent-electron close --json
```

Every command returns structured JSON with `--json`:
```json
{"success": true, "data": {"snapshot": "...", "refs": {"e1": {...}}}}
{"success": false, "error": "element_not_found", "message": "Ref @e5 not found"}
```

## Essential Commands

### App Lifecycle

```bash
# Launch from source (main.js)
agent-electron launch <path> [args...]

# Launch pre-built app (VS Code, Slack, etc.)
agent-electron launch -e "/Applications/Visual Studio Code.app/Contents/MacOS/Electron" \
  "/Applications/Visual Studio Code.app/Contents/Resources/app/out/main.js"

# Connect to already-running app via CDP
agent-electron connect <port>

# Close app and daemon
agent-electron close
```

### Snapshot (How AI Agents "See" the App)

```bash
agent-electron snapshot                  # Full accessibility tree
agent-electron snapshot -i              # Interactive elements only (recommended)
agent-electron snapshot -c              # Compact
agent-electron snapshot -d 3            # Depth limit
agent-electron snapshot -s "#selector"  # Scope to CSS selector
```

### Interaction

```bash
# Click
agent-electron click @e3                # Click by ref
agent-electron click --text "Submit"    # Click by visible text label

# Text input
agent-electron fill @e2 "text"          # Clear and fill
agent-electron type @e2 "text"          # Type key-by-key (no clear)

# Other
agent-electron press Enter              # Press key
agent-electron select @e4 "option"      # Select dropdown
agent-electron check @e5                # Check checkbox
agent-electron hover @e6                # Hover
agent-electron scroll down 300          # Scroll
```

### Click by Text Label

When refs are unavailable or you know the button label, use `click --text`:

```bash
agent-electron click --text "Services"                    # Default: 10 retries, 150ms delay
agent-electron click --text "Integrations" --retries 5    # Custom retry count
agent-electron click --text "Submit" --retry-delay 200    # Custom delay
agent-electron click --text "Memories" --scope-selector "#active-frame"  # Scoped search
```

Matching rules: case-insensitive, whitespace-normalized, exact text match against visible interactive elements (`button`, `a`, `[role=button|tab|link]`). Fires `pointerdown` -> `mousedown` -> `mouseup` -> `click`. On failure, the error includes the requested label and a list of visible labels found on the page.

Use `--scope-selector` to restrict the text search to a specific container or iframe. If the selector matches an `<iframe>`/`<frame>`, the search uses its `contentDocument`. Otherwise, the matched element is the container root. Fails with `invalid_scope_selector` if the selector is not found, or `scope_not_accessible` if the iframe's contentDocument is not accessible (e.g., cross-origin).

### Editor Interaction (Monaco / Contenteditable)

For rich text editors inside CDP targets:

```bash
agent-electron editor set ".monaco-editor" "hello world"     # Clear + type + verify
agent-electron editor get ".monaco-editor"                    # Read visible text
agent-electron editor set 'div[contenteditable]' "new text"  # Works with contenteditable
agent-electron editor set ".editor" "hello" --scope-selector "iframe.content"  # Scoped to iframe
agent-electron editor get ".editor" --scope-selector "#panel"                  # Scoped to container
```

`editor set` focuses the editor, selects all (Cmd/Ctrl+A), deletes, types key-by-key via CDP events, then verifies the result matches. Retries up to 3 attempts. On failure, reports actual visible text.

`editor get` reads rendered text (Monaco: `.view-line` elements; contenteditable: text content) with whitespace normalization.

Use `--scope-selector` to restrict the editor lookup to a specific container or iframe. The selector is resolved against the top-level document:

- If it matches an `<iframe>` or `<frame>`, the lookup uses its `contentDocument`.
- Otherwise, the matched element is used as the subtree root.
- Fails with `invalid_scope_selector` if not found, or `scope_not_accessible` if the iframe's contentDocument is not accessible (e.g., cross-origin).

**Requires an active CDP session** (via `target switch`).

### Evaluate JavaScript

```bash
agent-electron eval "document.title"                                  # Renderer JS
agent-electron eval-main "BrowserWindow.getAllWindows().length"        # Main process JS
```

### Get Info

```bash
agent-electron get text @e1             # Element text
agent-electron get value @e2            # Input value
agent-electron get title                # Window title
agent-electron get url                  # Current URL
agent-electron is-visible @e3           # Check visibility
```

### Screenshot

```bash
agent-electron screenshot               # Save to /tmp
agent-electron screenshot ./output.png  # Save to path
agent-electron screenshot --full        # Full page
```

### Wait

```bash
agent-electron wait @e3                 # Wait for element visible
agent-electron wait 1000                # Wait milliseconds
agent-electron wait --text "Done"       # Wait for text to appear
agent-electron wait --gone @spinner     # Wait for element to disappear
agent-electron wait --fn "window.ready" # Wait for JS condition
```

## CDP Targets (Webviews)

Extension webviews (e.g., VS Code extensions) are separate CDP targets. Use `target` commands to reach them:

```bash
agent-electron target list                                # List all CDP targets
agent-electron target switch 1                            # Switch by index
agent-electron target switch --match augment              # Switch by title/URL substring
agent-electron target switch --match webview --all        # List matches without switching
agent-electron target switch 0                            # Switch back to main page
```

Once switched, `eval`, `snapshot`, `click`, `fill`, and `editor` commands operate within that target's context.

### VS Code Extension Webview Workflow

```bash
# Connect to VS Code (started with --remote-debugging-port=9222)
agent-electron connect 9222

# Find and switch to the extension webview
agent-electron target switch --match augment

# Interact inside the webview
agent-electron snapshot -i
agent-electron click --text "Memories"
agent-electron editor set ".memory-editor" "new memory text"

# Switch back for screenshots
agent-electron target switch 0
agent-electron screenshot
```

### Alternative: Frame-Based Navigation

Some webviews are accessible as frames rather than CDP targets:

```bash
agent-electron frame list               # List frames
agent-electron frame switch 2           # Switch to inner frame
agent-electron snapshot -i              # Interact within frame
agent-electron frame reset              # Return to main frame
```

## Windows

```bash
agent-electron window list              # List all windows
agent-electron window switch 1          # Switch to window by index
```

## Common Patterns

### Automate a Custom Electron App

```bash
agent-electron launch ./my-app/main.js
agent-electron snapshot -i
agent-electron fill @e2 "test input"
agent-electron click @e3
agent-electron wait --text "Success"
agent-electron screenshot result.png
agent-electron close
```

### Test a VS Code Extension

```bash
# Start VS Code with debugging
code --remote-debugging-port=9222

# Connect and navigate to extension
agent-electron connect 9222
agent-electron target switch --match "my-extension"

# Interact with extension UI
agent-electron snapshot -i
agent-electron click --text "Settings"
agent-electron fill @e5 "new value"
agent-electron click --text "Save"

# Verify
agent-electron snapshot -i
agent-electron screenshot verify.png

# Cleanup
agent-electron close
```

### Launch a Pre-Built App

```bash
# VS Code (macOS)
agent-electron launch -e "/Applications/Visual Studio Code.app/Contents/MacOS/Electron" \
  "/Applications/Visual Studio Code.app/Contents/Resources/app/out/main.js"

# Slack (macOS)
agent-electron launch -e "/Applications/Slack.app/Contents/MacOS/Slack"

# Any packaged app (Linux)
agent-electron launch -e /usr/lib/code/code
```

### Interact with Monaco Editors in Webviews

```bash
agent-electron connect 9222
agent-electron target switch --match "my-extension"

# Write text into a Monaco editor
agent-electron editor set ".monaco-editor" "function hello() { return 42; }"

# Read it back
agent-electron editor get ".monaco-editor"

agent-electron target switch 0
```

## Global Options

| Option | Description |
|--------|-------------|
| `--json` | Structured JSON output (recommended for agents) |
| `--timeout <ms>` | Override default timeout |
| `--debug` | Verbose debug output |

## Error Codes

| Code | Meaning |
|------|---------|
| `app_not_running` | No app connected. Run `launch` or `connect`. |
| `launch_failed` | Failed to start app. |
| `connection_failed` | CDP connection failed. |
| `element_not_found` | Ref, selector, or text label not found. |
| `element_not_visible` | Element exists but not interactable. |
| `invalid_scope_selector` | `--scope-selector` did not match any element. |
| `scope_not_accessible` | `--scope-selector` matched an iframe/frame whose contentDocument is not accessible (cross-origin, etc.). |
| `timeout` | Operation timed out. |
| `eval_error` | JavaScript error in eval. |
| `invalid_command` | Bad command or arguments. |

## Ref Lifecycle (Important)

Refs (`@e1`, `@e2`, etc.) are invalidated when the page changes. Always re-snapshot after:

- Clicking links or buttons that navigate
- Form submissions
- Dynamic content loading (dropdowns, modals, tab switches)

```bash
agent-electron click @e5              # May trigger navigation
agent-electron snapshot -i            # MUST re-snapshot
agent-electron click @e1              # Use new refs
```

## Architecture

Client-daemon pattern over a Unix socket:
1. **CLI** parses commands, sends to daemon
2. **Daemon** manages Playwright Electron instance, executes commands
3. Daemon auto-starts on first command, persists between commands (no cold start)

Built on [Playwright](https://playwright.dev/)'s `_electron` API. For webview targets, uses raw CDP WebSocket connections.

## Deep-Dive Documentation

| Reference | When to Use |
|-----------|-------------|
| [references/commands.md](references/commands.md) | Full command reference with all options and arguments |
| [references/cdp-targets.md](references/cdp-targets.md) | CDP targets, webviews, and frame navigation details |
| [references/editor-interaction.md](references/editor-interaction.md) | Monaco and contenteditable editor interaction details |

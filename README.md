# agent-electron

Electron app automation CLI for AI agents. Designed for the build-and-verify loop.

## Development

```bash
npm install
npm run build
npm test  # requires Xvfb on Linux
```

## Why not just use Playwright?

Playwright is a browser testing library. agent-electron is a CLI tool that lets an AI agent drive any Electron app the same way a human would use DevTools.

- **CLI-native interface** — One shell command per action, structured JSON back. No writing/executing scripts. This is how coding agents already work (they run `git`, `npm`, `curl`).
- **See-then-act with refs** — `snapshot -i` gives a compact accessibility view with handles. The agent doesn't need CSS selectors, XPaths, or DOM structure. It reads what's on screen and acts on it by name.
- **Electron-specific features Playwright doesn't have** — CDP target switching for webviews (VS Code extensions, etc.), main process eval, connecting to already-running apps. Built from scratch on raw WebSocket CDP.
- **Zero setup, zero teardown** — The daemon auto-starts on first command, holds state, and cleans up on `close`. No boilerplate, no connection management, no script scaffolding.
- **Works with pre-built apps (WIP)** — Launch VS Code, Slack, or any packaged Electron app. Playwright's `_electron` API is designed for testing your own app from source; agent-electron extends it to arbitrary installed apps.

agent-electron is mostly powerful when used for both test authoring and test running.

- **Test authoring**: An engineer can give some high-level direction, such as "send hello in the chat window," and the AI agent can interactively explore, interact with, and verify Electron UIs through sequential commands.

- **Test running**: Once the agent has found a path to achieve the high-level goal, the engineer can codify the path by asking the agent to write the steps down in a regular test file. Then, the test can be run in the future without incurring LLM costs.

## Quick Start

```bash
npm install -g agent-electron

# Launch an Electron app from source
agent-electron launch ./my-app/main.js

# Launch a pre-built Electron app (VS Code, Slack, etc.)
agent-electron launch -e "/Applications/Visual Studio Code.app/Contents/MacOS/Electron" \
  "/Applications/Visual Studio Code.app/Contents/Resources/app/out/main.js"

# Connect to an already-running app via CDP
code --remote-debugging-port=9222
agent-electron connect 9222

# Get accessibility tree with element refs
agent-electron snapshot -i
# - heading "My App" [ref=e1] [level=1]
# - textbox "Search" [ref=e2]
# - button "Submit" [ref=e3]

# Interact using refs
agent-electron fill @e2 "hello world"
agent-electron click @e3

# Verify state
agent-electron eval "document.querySelector('#result').textContent"
agent-electron screenshot verify.png

# Close
agent-electron close
```

## Build-Verify Loop (for AI Agents)

```bash
# Agent builds the app
npx electron-vite build

# Agent launches and verifies
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

## Commands

### App Lifecycle
```bash
agent-electron launch <path> [args...]               # Launch from main.js
agent-electron launch -e <executable> [path] [args...] # Launch pre-built app
agent-electron connect <port>                         # Connect to running app via CDP
agent-electron close                                  # Close app + daemon
```

#### Launching Pre-Built Apps

Use `--executable-path` (or `-e`) to launch packaged Electron apps like VS Code, Slack, etc.:

```bash
# VS Code (macOS)
agent-electron launch -e "/Applications/Visual Studio Code.app/Contents/MacOS/Electron" \
  "/Applications/Visual Studio Code.app/Contents/Resources/app/out/main.js"

# Slack (macOS)
agent-electron launch -e "/Applications/Slack.app/Contents/MacOS/Slack"

# Any packaged app (Linux)
agent-electron launch -e /usr/lib/code/code
```

#### Connecting to Running Apps (CDP)

For apps already running (preserves login state, extensions, etc.):

```bash
# Start VS Code with remote debugging
code --remote-debugging-port=9222

# Connect
agent-electron connect 9222
```

### Snapshot (AI agents' primary way to "see" the app)
```bash
agent-electron snapshot                  # Full accessibility tree
agent-electron snapshot -i              # Interactive elements only
agent-electron snapshot -c              # Compact
agent-electron snapshot -d 3            # Depth limit
```

### Interaction
```bash
agent-electron click @e3                # Click by ref
agent-electron click --text "Submit"    # Click by visible text label
agent-electron fill @e2 "text"          # Fill input
agent-electron type @e2 "text"          # Type key-by-key
agent-electron press Enter              # Press key
agent-electron select @e4 "option"      # Select dropdown
agent-electron check @e5                # Check checkbox
agent-electron hover @e6                # Hover
agent-electron scroll down 300          # Scroll
```

#### Click by Text Label

`click --text` finds a visible interactive element (`button`, `a`, `[role=button|tab|link]`) whose text content matches the given label (case-insensitive, whitespace-normalized, exact match). It fires the full event sequence (`pointerdown` -> `mousedown` -> `mouseup` -> `click`) and retries up to 10 times with 150ms delay to handle late-rendering elements.

```bash
agent-electron click --text "Services"                    # Default: 10 retries, 150ms delay
agent-electron click --text "Integrations" --retries 5    # Custom retry count
agent-electron click --text "Submit" --retry-delay 200    # Custom delay between retries
agent-electron click --text "Memories" --scope-selector "#active-frame"  # Scoped search
```

On failure, the error message includes the requested label and a list of visible interactive labels found on the page, which helps debug issues like `services_page_not_visible`.

Use `--scope-selector` to restrict the text search to a specific container or iframe. The selector is resolved against the top-level document:

- If it matches an `<iframe>` or `<frame>`, the search uses its `contentDocument`.
- Otherwise, the matched element is used as the container root.
- Fails with `invalid_scope_selector` if the selector is not found, or `scope_not_accessible` if the iframe's contentDocument is not accessible (e.g., cross-origin).

### Editor (Monaco / Contenteditable)

For interacting with rich text editors (Monaco code editors, contenteditable elements) inside CDP targets. These commands handle focus, clearing, key-by-key typing, and verification automatically.

```bash
agent-electron editor set ".monaco-editor" "hello world"   # Clear + type + verify
agent-electron editor get ".monaco-editor"                  # Read visible text
agent-electron editor set 'div[contenteditable]' "new text" # Works with contenteditable too
agent-electron editor set ".editor" "hello" --scope-selector "iframe.frame"  # Scoped to iframe
agent-electron editor get ".editor" --scope-selector "#container"            # Scoped to container
```

`editor set` focuses the editor, selects all (Cmd/Ctrl+A), deletes, types key-by-key, then verifies the result matches. Retries up to 3 attempts. On failure, reports the actual visible text for debugging.

`editor get` reads rendered text from Monaco (`.view-line` elements) or contenteditable elements, with consistent whitespace normalization.

Use `--scope-selector` to restrict the editor lookup to a specific container or iframe. If the selector matches an `<iframe>`/`<frame>`, the lookup uses its `contentDocument`. Otherwise, the matched element's subtree is used. Fails with `invalid_scope_selector` if not found, or `scope_not_accessible` if the iframe's contentDocument is not accessible (e.g., cross-origin).

### Evaluate JavaScript
```bash
agent-electron eval "document.title"                    # Renderer JS
agent-electron eval-main "BrowserWindow.getAllWindows().length"  # Main process JS
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
agent-electron wait --text "Done"       # Wait for text
agent-electron wait --gone @spinner     # Wait for element to disappear
agent-electron wait --fn "window.ready" # Wait for JS condition
```

### Windows
```bash
agent-electron window list              # List all windows
agent-electron window switch 1          # Switch to window
```

### Frames
```bash
agent-electron frame list               # List all frames in active window
agent-electron frame switch 1           # Switch to a frame by index
agent-electron frame reset              # Switch back to the main frame
```

### CDP Targets (Webviews)

For interacting with extension webviews (e.g. VS Code extensions like Augment, Copilot), which are separate CDP targets not accessible as regular frames:

```bash
agent-electron target list              # List all CDP targets (pages + iframes)
agent-electron target switch 1          # Switch to a target by index
agent-electron target switch --match augment   # Switch by title/URL substring match
agent-electron target switch --match webview --all  # List matches without switching
agent-electron target switch 0          # Switch back to main page
```

The `--match` flag does a case-insensitive substring search against each target's title and URL. If multiple targets match, the first one is selected. If none match, the command fails and prints all available targets. Use `--all` to preview matches without switching (useful for discovery/debugging).

When switched to a CDP target, `eval`, `snapshot`, `click`, and `fill` commands operate within that target's context. Example workflow for interacting with a VS Code extension webview:

```bash
# Connect to VS Code
agent-electron connect 9222

# Find the extension webview by name
agent-electron target switch --match augment

# Or find it manually
agent-electron target list
#   0: [page] VS Code (vscode-file://...)
#   1: [iframe] vscode-webview://...extensionId=MyExtension...
agent-electron target switch 1

# Now eval runs inside the webview
agent-electron eval "document.querySelector('.my-input').value"

# Switch back to main page for screenshots
agent-electron target switch 0
agent-electron screenshot
```

## Options

| Option | Description |
|--------|-------------|
| `--json` | Structured JSON output (recommended for agents) |
| `--timeout <ms>` | Override default timeout |
| `--debug` | Verbose debug output |

## Error Codes

| Code | Meaning |
|------|---------|
| `app_not_running` | No app connected. Run launch or connect. |
| `launch_failed` | Failed to start app. |
| `connection_failed` | CDP connection failed. |
| `element_not_found` | Ref or selector not found. |
| `element_not_visible` | Element exists but not interactable. |
| `invalid_scope_selector` | `--scope-selector` did not match any element. |
| `scope_not_accessible` | `--scope-selector` matched an iframe/frame whose contentDocument is not accessible (cross-origin, etc.). |
| `timeout` | Operation timed out. |
| `eval_error` | JavaScript error. |
| `invalid_command` | Bad command or arguments. |

## Architecture

Client-daemon pattern over a Unix socket:
1. **CLI** parses commands, sends to daemon via Unix socket
2. **Daemon** manages Playwright Electron instance, executes commands
3. Daemon auto-starts on first command, persists between commands (no cold start)

Built on [Playwright](https://playwright.dev/)'s `_electron` API. For webview iframe targets, uses raw CDP WebSocket connections.



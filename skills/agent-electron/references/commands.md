# Command Reference

Complete reference for all `agent-electron` commands with full options and arguments.

## App Lifecycle

### launch

Launch an Electron app.

```bash
agent-electron launch <path> [args...]
agent-electron launch -e <executable> [path] [args...]
```

| Argument/Option | Description |
|-----------------|-------------|
| `<path>` | Path to the app's main.js entry point |
| `[args...]` | Additional arguments passed to the Electron app |
| `-e, --executable-path <path>` | Path to a pre-built Electron executable |

**Examples:**

```bash
# Launch from source
agent-electron launch ./my-app/main.js

# Launch with arguments
agent-electron launch ./my-app/main.js --no-sandbox

# Launch VS Code (macOS)
agent-electron launch -e "/Applications/Visual Studio Code.app/Contents/MacOS/Electron" \
  "/Applications/Visual Studio Code.app/Contents/Resources/app/out/main.js"

# Launch Slack (macOS)
agent-electron launch -e "/Applications/Slack.app/Contents/MacOS/Slack"
```

Default timeout: 30000ms

### connect

Connect to an already-running Electron app via Chrome DevTools Protocol.

```bash
agent-electron connect <port>
```

| Argument | Description |
|----------|-------------|
| `<port>` | CDP debugging port number |

**Example:**

```bash
# Start VS Code with debugging enabled
code --remote-debugging-port=9222

# Connect
agent-electron connect 9222
```

Default timeout: 10000ms

### close

Close the app and shut down the daemon.

```bash
agent-electron close
```

Default timeout: 5000ms

---

## Snapshot

Get the accessibility tree of the current page/target, with element refs for interaction.

```bash
agent-electron snapshot [options]
```

| Option | Description |
|--------|-------------|
| `-i, --interactive` | Show only interactive elements (recommended) |
| `-c, --compact` | Remove empty structural elements |
| `-d, --depth <n>` | Maximum tree depth |
| `-s, --selector <sel>` | Scope to a CSS selector |

**Examples:**

```bash
agent-electron snapshot -i              # Interactive elements with refs
agent-electron snapshot -i -c           # Compact interactive elements
agent-electron snapshot -d 3            # Limit depth to 3
agent-electron snapshot -s "#sidebar"   # Only elements inside #sidebar
```

Default timeout: 10000ms

---

## Interaction

### click

Click an element by ref, CSS selector, or visible text label.

```bash
agent-electron click <target>
agent-electron click --text <label> [options]
```

| Argument/Option | Description |
|-----------------|-------------|
| `<target>` | Element ref (`@e3`) or CSS selector |
| `-t, --text <label>` | Click by visible text label |
| `--retries <n>` | Retry attempts for `--text` (default: 10) |
| `--retry-delay <ms>` | Delay between retries in ms (default: 150) |
| `--scope-selector <sel>` | Scope text search to a container or iframe |

**Text matching rules:** case-insensitive, whitespace-normalized, exact match. Searches `button`, `a`, `[role=button|tab|link]`.

**Event sequence:** `pointerdown` -> `mousedown` -> `mouseup` -> `click`

**Scope selector:** When `--scope-selector` is provided, the selector is resolved in the top-level document. If it matches an `<iframe>` or `<frame>`, the search uses its `contentDocument`. Otherwise, the matched element is used as the container root. Fails with `invalid_scope_selector` if the selector is not found, or `scope_not_accessible` if the iframe's contentDocument is not accessible (e.g., cross-origin).

**Examples:**

```bash
agent-electron click @e3                                 # Click by ref
agent-electron click "#submit-btn"                       # Click by CSS selector
agent-electron click --text "Submit"                     # Click by text label
agent-electron click --text "Services" --retries 20      # More retries
agent-electron click --text "Save" --retry-delay 300     # Slower retries
agent-electron click --text "Memories" --scope-selector "#active-frame"  # Scoped to container
agent-electron click --text "Submit" --scope-selector "iframe.form-frame" # Scoped to iframe
```

Default timeout: 5000ms

### fill

Clear an input and fill it with text.

```bash
agent-electron fill <target> <text>
```

| Argument | Description |
|----------|-------------|
| `<target>` | Element ref (`@e2`) or CSS selector |
| `<text>` | Text to fill |

**Example:**

```bash
agent-electron fill @e2 "hello@example.com"
```

Default timeout: 5000ms

### type

Type text key-by-key without clearing the input first.

```bash
agent-electron type <target> <text>
```

| Argument | Description |
|----------|-------------|
| `<target>` | Element ref or CSS selector |
| `<text>` | Text to type |

Default timeout: 5000ms

### press

Press a keyboard key.

```bash
agent-electron press <key>
```

| Argument | Description |
|----------|-------------|
| `<key>` | Key name (Enter, Tab, Escape, ArrowDown, etc.) |

**Examples:**

```bash
agent-electron press Enter
agent-electron press Tab
agent-electron press Escape
agent-electron press ArrowDown
```

Default timeout: 5000ms

### select

Select a dropdown option.

```bash
agent-electron select <target> <value>
```

Default timeout: 5000ms

### check

Check a checkbox.

```bash
agent-electron check <target>
```

Default timeout: 5000ms

### hover

Hover over an element.

```bash
agent-electron hover <target>
```

Default timeout: 5000ms

### scroll

Scroll the page.

```bash
agent-electron scroll <direction> [amount]
```

| Argument | Description |
|----------|-------------|
| `<direction>` | `up`, `down`, `left`, or `right` |
| `[amount]` | Pixels to scroll (optional) |

**Example:**

```bash
agent-electron scroll down 500
```

Default timeout: 5000ms

---

## Editor Interaction

### editor set

Set text in a Monaco or contenteditable editor. Focuses the editor, clears it (Cmd/Ctrl+A + delete), types key-by-key, and verifies the result. Retries up to 3 attempts.

```bash
agent-electron editor set <target> <text> [options]
```

| Argument/Option | Description |
|-----------------|-------------|
| `<target>` | CSS selector for the editor element |
| `<text>` | Text to set |
| `--scope-selector <sel>` | Scope editor lookup to a container or iframe |

**Requires an active CDP session.**

**Scope selector:** When `--scope-selector` is provided, the selector is resolved in the top-level document. If it matches an `<iframe>` or `<frame>`, the editor lookup runs in its `contentDocument`. Otherwise, the matched element's subtree is used. Fails with `invalid_scope_selector` if the selector is not found, or `scope_not_accessible` if the iframe's contentDocument is not accessible (e.g., cross-origin).

**Examples:**

```bash
agent-electron editor set ".monaco-editor" "function hello() { return 42; }"
agent-electron editor set 'div[contenteditable="true"]' "new content"
agent-electron editor set ".editor" "hello" --scope-selector "iframe.my-frame"
agent-electron editor set ".editor" "hello" --scope-selector "#editor-container"
```

Default timeout: 10000ms

### editor get

Read visible text from a Monaco or contenteditable editor.

```bash
agent-electron editor get <target> [options]
```

| Argument/Option | Description |
|-----------------|-------------|
| `<target>` | CSS selector for the editor element |
| `--scope-selector <sel>` | Scope editor lookup to a container or iframe |

**Requires an active CDP session.**

Returns normalized visible text (Monaco: from `.view-line` elements; contenteditable: from text content).

**Scope selector:** When `--scope-selector` is provided, the selector is resolved in the top-level document. If it matches an `<iframe>` or `<frame>`, the editor lookup runs in its `contentDocument`. Otherwise, the matched element's subtree is used. Fails with `invalid_scope_selector` if the selector is not found, or `scope_not_accessible` if the iframe's contentDocument is not accessible (e.g., cross-origin).

**Examples:**

```bash
agent-electron editor get ".monaco-editor"
agent-electron editor get ".editor" --scope-selector "iframe.content-frame"
agent-electron editor get ".editor" --scope-selector "#panel"
```

Default timeout: 5000ms

---

## Evaluate JavaScript

### eval

Run JavaScript in the renderer process (or current CDP target).

```bash
agent-electron eval <script>
```

**Examples:**

```bash
agent-electron eval "document.title"
agent-electron eval "document.querySelector('.count').textContent"
agent-electron eval "JSON.stringify(Array.from(document.querySelectorAll('li')).map(e => e.textContent))"
```

Default timeout: 10000ms

### eval-main

Run JavaScript in the Electron main process.

```bash
agent-electron eval-main <script>
```

**Example:**

```bash
agent-electron eval-main "BrowserWindow.getAllWindows().length"
```

Default timeout: 10000ms

---

## Get Info

### get text

Get text content of an element.

```bash
agent-electron get text <target>
```

### get value

Get the value of an input element.

```bash
agent-electron get value <target>
```

### get title

Get the window title.

```bash
agent-electron get title
```

### get url

Get the current URL.

```bash
agent-electron get url
```

### is-visible

Check if an element is visible.

```bash
agent-electron is-visible <target>
```

All `get` commands default timeout: 5000ms

---

## Screenshot

```bash
agent-electron screenshot [path]
```

| Argument/Option | Description |
|-----------------|-------------|
| `[path]` | Output file path (defaults to /tmp) |
| `-f, --full` | Full page screenshot |

**Examples:**

```bash
agent-electron screenshot                    # Save to /tmp
agent-electron screenshot ./output.png       # Save to specific path
agent-electron screenshot --full result.png  # Full page
```

Default timeout: 10000ms

---

## Wait

Wait for an element, time, text, or JavaScript condition.

```bash
agent-electron wait [target]
agent-electron wait [options]
```

| Argument/Option | Description |
|-----------------|-------------|
| `[target]` | Element ref or CSS selector to wait for |
| `--text <text>` | Wait for text to appear on page |
| `--gone <selector>` | Wait for element to disappear |
| `--fn <expression>` | Wait for JS condition to be truthy |

If `[target]` is a number, it is treated as milliseconds to wait.

**Examples:**

```bash
agent-electron wait @e3                  # Wait for element
agent-electron wait 2000                 # Wait 2 seconds
agent-electron wait --text "Success"     # Wait for text
agent-electron wait --gone @spinner      # Wait for disappearance
agent-electron wait --fn "window.ready"  # Wait for JS condition
```

Default timeout: 30000ms

---

## Window Management

### window list

```bash
agent-electron window list
```

### window switch

```bash
agent-electron window switch <index>
```

Default timeout: 5000ms

---

## Frame Management

### frame list

List all frames in the active window.

```bash
agent-electron frame list
```

### frame switch

Switch to a frame by index.

```bash
agent-electron frame switch <index>
```

### frame reset

Switch back to the main frame.

```bash
agent-electron frame reset
```

Default timeout: 5000ms

---

## CDP Target Management

### target list

List all CDP targets (pages and webview iframes).

```bash
agent-electron target list
```

### target switch

Switch to a CDP target by index or substring match.

```bash
agent-electron target switch <index>
agent-electron target switch --match <substring> [--all]
```

| Argument/Option | Description |
|-----------------|-------------|
| `<index>` | Target index from `target list` |
| `-m, --match <substring>` | Match by title/URL substring (case-insensitive) |
| `--all` | Print matches without switching |

**Examples:**

```bash
agent-electron target switch 1                            # By index
agent-electron target switch --match augment              # By substring
agent-electron target switch --match webview --all        # Discovery mode
agent-electron target switch 0                            # Back to main
```

Default timeout: 10000ms

---

## Global Options

| Option | Description |
|--------|-------------|
| `--json` | Structured JSON output (recommended for agents) |
| `--timeout <ms>` | Override default timeout for any command |
| `--debug` | Verbose debug output |

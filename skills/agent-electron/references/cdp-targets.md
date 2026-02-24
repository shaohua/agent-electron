# CDP Targets, Webviews, and Frame Navigation

This reference covers how to interact with extension webviews and embedded iframes in Electron apps, particularly VS Code extensions.

## Background

Electron apps like VS Code use multiple rendering contexts:

- **Main page**: The primary app window (workbench, sidebar, tabs)
- **Frames**: Embedded `<iframe>` elements within the main page
- **CDP targets**: Separate browser contexts (pages, iframes) accessible via Chrome DevTools Protocol — used by extension webviews

Extension webviews (e.g., Augment, Copilot sidebars in VS Code) are **not** regular frames. They are separate CDP targets with their own JavaScript context, DOM, and security boundary.

## When to Use What

| Scenario | Approach |
|----------|----------|
| Elements in the main app UI | Direct commands (no switching needed) |
| Content inside a regular `<iframe>` | `frame switch` |
| VS Code extension webview | `target switch` |
| Webview with Monaco editor | `target switch` + `editor set/get` |

## CDP Target Workflow

### 1. Connect to the Running App

```bash
# Start the app with CDP debugging enabled
code --remote-debugging-port=9222

# Connect
agent-electron connect 9222
```

### 2. Discover Available Targets

```bash
agent-electron target list
#   0: [page] VS Code (vscode-file://...)
#   1: [iframe] vscode-webview://...extensionId=Augment.vscode-augment...
#   2: [iframe] vscode-webview://...extensionId=GitHub.copilot...
```

Or search by name:

```bash
agent-electron target switch --match augment --all
#   1: [iframe] Augment (vscode-webview://...extensionId=Augment.vscode-augment...)
```

### 3. Switch to a Target

```bash
# By index
agent-electron target switch 1

# By substring match (case-insensitive, checks title + URL)
agent-electron target switch --match augment
```

If multiple targets match `--match`, the first one is selected. If none match, the error includes all available targets for debugging.

### 4. Interact Within the Target

Once switched, all commands operate inside that target's context:

```bash
agent-electron snapshot -i              # See the extension's UI
agent-electron click --text "Memories"  # Click within the webview
agent-electron eval "document.title"    # JS runs inside the webview
agent-electron editor set ".monaco-editor" "new content"  # Editor interaction
```

### 5. Switch Back

```bash
agent-electron target switch 0         # Back to main page
agent-electron screenshot              # Screenshots from main context
```

## Frame-Based Navigation

Some embedded content uses regular frames instead of CDP targets. This is common for:

- Simple embedded iframes
- VS Code webview inner content (the `fake.html` frame)

```bash
# List frames in the active window
agent-electron frame list
#   0: (main) (vscode-file://...)
#   1: webview-host (vscode-webview://...)
#   2: pending-frame (vscode-webview://.../fake.html?id=...)

# Switch to inner frame
agent-electron frame switch 2

# Interact within frame
agent-electron snapshot -i
agent-electron click @e5

# Return to main frame
agent-electron frame reset
```

### VS Code Frame Structure

In VS Code, extension webviews have a nested frame structure:

- **Frame 0**: Main VS Code workbench
- **Frame 1**: Webview host (outer `<webview>` element) — snapshotting shows only `document > document > iframe`, not useful
- **Frame 2**: Inner content (`fake.html` / `pending-frame`) — this is where the extension's actual UI lives

Always use `frame list` and look for `extensionId=` in the URL to identify the correct frame.

## CDP Target vs Frame: How to Choose

Try **CDP targets first** (`target list` / `target switch`). This is the more robust approach and works with extension webviews that have their own JavaScript context.

Fall back to **frames** (`frame list` / `frame switch`) when:
- The target doesn't appear in `target list`
- You need to reach content inside a nested iframe within a webview
- The content is a simple embedded iframe in the main page

## Troubleshooting

### "No CDP targets found"

The app may not expose CDP targets. Ensure it was started with remote debugging:

```bash
code --remote-debugging-port=9222
# or
agent-electron launch -e <path> --remote-debugging-port=9222
```

### Target switch succeeds but snapshot is empty

The webview may not be visible. Ensure the extension panel is open:

```bash
# Switch back to main page
agent-electron target switch 0

# Click the extension tab to make it visible
agent-electron click @e81  # Use the ref from snapshot

# Switch back to the target
agent-electron target switch --match my-extension
```

### "element_not_found" inside a CDP target

The DOM may still be loading. Add a wait:

```bash
agent-electron target switch --match my-extension
agent-electron wait 1000                     # Wait for render
agent-electron snapshot -i                   # Then interact
```

Or use `click --text` which has built-in retry logic:

```bash
agent-electron click --text "Settings"       # Retries up to 10 times
```

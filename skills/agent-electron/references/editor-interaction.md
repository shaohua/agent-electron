# Editor Interaction (Monaco / Contenteditable)

This reference covers the `editor set` and `editor get` commands for interacting with rich text editors inside CDP targets.

## Overview

The `editor` commands provide reliable text input and reading for:

- **Monaco editors** (used by VS Code, many web-based code editors)
- **Contenteditable elements** (rich text editors, WYSIWYG editors)

These commands handle the complexities of editor interaction — focus management, content clearing, key-by-key typing via CDP events, and verification — so you don't need to write custom JavaScript.

## Prerequisites

**An active CDP session is required.** Switch to a CDP target before using editor commands:

```bash
agent-electron connect 9222
agent-electron target switch --match my-extension
# Now editor commands work
```

## Commands

### editor set

Set text in an editor with automatic clear, type, and verify.

```bash
agent-electron editor set <selector> <text> [--scope-selector <sel>]
```

**What it does (in order):**

1. Finds the editor element matching `<selector>`
2. Detects editor type (Monaco or contenteditable)
3. Focuses the editor
4. Selects all content (Cmd+A on macOS, Ctrl+A on Linux/Windows)
5. Deletes the selection (Backspace)
6. Types the new text character-by-character via CDP `Input.dispatchKeyEvent`
7. Reads back the visible text using `editor get` logic
8. Verifies the result matches the input
9. If verification fails, retries from step 3 (up to 3 total attempts)

**On success**, returns:

```json
{
  "success": true,
  "data": {
    "text": "the text that was set",
    "editorType": "monaco",
    "attempts": 1
  }
}
```

**On failure** (text doesn't match after 3 attempts), returns:

```json
{
  "success": false,
  "error": "element_not_found",
  "message": "editor set failed after 3 attempts — expected: \"hello world\", actual: \"hello worl\""
}
```

### editor get

Read visible text from an editor.

```bash
agent-electron editor get <selector> [--scope-selector <sel>]
```

**Detection logic:**

1. Looks for a Monaco editor within or matching `<selector>`:
   - Reads text from `.view-lines .view-line` elements
   - Joins lines with newlines
2. Falls back to contenteditable:
   - Reads `textContent` from the contenteditable element
3. Normalizes whitespace: trims each line, removes empty leading/trailing lines

**On success**, returns:

```json
{
  "success": true,
  "data": {
    "text": "visible text content",
    "editorType": "monaco"
  }
}
```

## Scope Selector

Use `--scope-selector` to look up the editor inside a specific container or iframe:

```bash
agent-electron editor get ".editor" --scope-selector "iframe.content-frame"
agent-electron editor set ".editor" "new text" --scope-selector "#editor-container"
```

When `--scope-selector` is provided, the selector is resolved in the top-level document:

- If it matches an `<iframe>` or `<frame>`, the editor lookup runs inside its `contentDocument`.
- Otherwise, the matched element's subtree is used as the lookup root.
- Fails with `invalid_scope_selector` if the selector is not found.
- Fails with `scope_not_accessible` if the scope element is an iframe/frame whose `contentDocument` is not accessible (e.g., cross-origin, sandboxed, or not yet loaded).

## Selectors

Use CSS selectors that identify the editor container:

```bash
# Monaco editors
agent-electron editor set ".monaco-editor" "code here"
agent-electron editor set "#my-editor .monaco-editor" "code here"

# Contenteditable elements
agent-electron editor set 'div[contenteditable="true"]' "rich text"
agent-electron editor set ".memory-editor" "memory content"

# By data attribute
agent-electron editor set '[data-testid="code-editor"]' "test code"
```

If the selector matches a container that contains a Monaco editor, the command will find the Monaco instance within it.

## Common Patterns

### Write and Read Back

```bash
agent-electron editor set ".monaco-editor" "function add(a, b) { return a + b; }"
agent-electron editor get ".monaco-editor"
# Output: function add(a, b) { return a + b; }
```

### Verify Editor Content in Tests

```bash
# Set content
agent-electron editor set ".monaco-editor" "expected content" --json

# Read back separately for assertion
CONTENT=$(agent-electron editor get ".monaco-editor")
if [ "$CONTENT" = "expected content" ]; then
  echo "PASS"
fi
```

### Replace Content in an Extension Webview

```bash
agent-electron connect 9222
agent-electron target switch --match my-extension

# Clear and replace editor content
agent-electron editor set ".memory-editor" "Updated memory text"

# Verify
agent-electron editor get ".memory-editor"

agent-electron target switch 0
agent-electron screenshot verify.png
```

## Troubleshooting

### "No CDP session active"

Editor commands require a CDP target. Switch first:

```bash
agent-electron target switch --match my-extension
# Then retry editor command
```

### "editor set failed after 3 attempts"

The editor may have custom input handling that conflicts with key events. Try:

1. Ensure the editor is fully loaded (`agent-electron wait 1000`)
2. Check that the selector matches the correct element
3. Try a simpler selector
4. As a fallback, use `eval` with custom JavaScript

### "Element not found" for a Monaco editor

The selector may not match. Debug by checking what's on the page:

```bash
agent-electron eval "document.querySelector('.monaco-editor') !== null"
agent-electron eval "document.querySelectorAll('[contenteditable]').length"
```

### "Scope selector not found" (invalid_scope_selector)

The `--scope-selector` CSS selector did not match any element in the top-level document. Verify the selector is correct:

```bash
agent-electron eval "document.querySelector('iframe.content-frame') !== null"
```

### "Scope element not accessible" (scope_not_accessible)

The `--scope-selector` matched an iframe/frame, but its `contentDocument` is not accessible. Common causes:

- Cross-origin iframe (different domain/protocol)
- Sandboxed iframe without `allow-same-origin`
- Iframe has not finished loading yet (try `agent-electron wait 1000` first)

As a workaround, use `target switch` to switch to the iframe's CDP target directly instead of using `--scope-selector`.

### Typed text appears garbled

This can happen with editors that have autocomplete or formatting. The verification step will catch this and retry. If it persists after 3 attempts, the error message shows the actual text so you can adjust your approach.

## How It Works Internally

- **Key events** are dispatched via CDP `Input.dispatchKeyEvent` (not DOM events), which means they go through the same path as real keyboard input
- **Select All** uses platform-appropriate modifier: `Meta` (Cmd) on macOS, `Control` on Linux/Windows
- **Character typing** sends `keyDown` + `char` + `keyUp` for each character, respecting the native key code for `a-z`, `0-9`, and common symbols
- **Monaco detection** checks for `.monaco-editor` class and reads from the rendered `.view-line` elements (not the hidden textarea)
- **Contenteditable detection** checks for the `contenteditable` attribute and reads from `textContent`

/**
 * Accessibility tree snapshot with element refs.
 * Ported from agent-browser's snapshot.ts — works on any Playwright Page.
 */

import type { Page, Frame } from 'playwright-core';
import type { RefMap } from './types.js';

export interface SnapshotResult {
  tree: string;
  refs: RefMap;
}

export interface SnapshotOptions {
  interactive?: boolean;
  compact?: boolean;
  maxDepth?: number;
  selector?: string;
}

let refCounter = 0;

function resetRefs(): void {
  refCounter = 0;
}

function nextRef(): string {
  return `e${++refCounter}`;
}

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'listbox',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'searchbox',
  'slider', 'spinbutton', 'switch', 'tab', 'treeitem',
]);

const CONTENT_ROLES = new Set([
  'heading', 'cell', 'gridcell', 'columnheader', 'rowheader',
  'listitem', 'article', 'region', 'main', 'navigation',
]);

function buildSelector(role: string, name?: string): string {
  if (name) {
    const escaped = name.replace(/"/g, '\\"');
    return `role=${role}[name="${escaped}"]`;
  }
  return `role=${role}`;
}

function getIndentLevel(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? Math.floor(match[1].length / 2) : 0;
}

export async function getSnapshot(page: Page | Frame, options: SnapshotOptions = {}): Promise<SnapshotResult> {
  resetRefs();
  const refs: RefMap = {};

  const locator = options.selector ? page.locator(options.selector) : page.locator(':root');

  let ariaTree: string;
  try {
    ariaTree = await locator.ariaSnapshot();
  } catch {
    return { tree: '(empty page)', refs: {} };
  }

  if (!ariaTree || ariaTree.trim() === '') {
    return { tree: '(empty page)', refs: {} };
  }

  const lines = ariaTree.split('\n');
  const result: string[] = [];

  // Track role+name counts for disambiguation
  const counts = new Map<string, number>();

  for (const line of lines) {
    const depth = getIndentLevel(line);

    // Depth filter
    if (options.maxDepth !== undefined && depth > options.maxDepth) continue;

    // Parse: "  - button "Submit" [level=1]"
    const match = line.match(/^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/);
    if (!match) {
      if (!options.interactive) result.push(line);
      continue;
    }

    const [, prefix, role, name, suffix] = match;
    const roleLower = role.toLowerCase();
    const isInteractive = INTERACTIVE_ROLES.has(roleLower);
    const isContent = CONTENT_ROLES.has(roleLower);

    // Interactive-only filter
    if (options.interactive && !isInteractive) continue;

    // Compact: skip unnamed structural elements
    if (options.compact && !isInteractive && !isContent && !name) continue;

    const shouldRef = isInteractive || (isContent && !!name);

    if (shouldRef) {
      const ref = nextRef();
      const key = `${roleLower}:${name || ''}`;
      const nth = counts.get(key) || 0;
      counts.set(key, nth + 1);

      refs[ref] = {
        selector: buildSelector(roleLower, name),
        role: roleLower,
        name,
        ...(nth > 0 ? { nth } : {}),
      };

      let enhanced = `${prefix}${role}`;
      if (name) enhanced += ` "${name}"`;
      enhanced += ` [ref=${ref}]`;
      if (nth > 0) enhanced += ` [nth=${nth}]`;
      if (suffix?.includes('[')) enhanced += suffix;

      result.push(enhanced);
    } else {
      result.push(line);
    }
  }

  const tree = result.join('\n') || (options.interactive ? '(no interactive elements)' : '(empty)');
  return { tree, refs };
}

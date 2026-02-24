#!/usr/bin/env node
/**
 * agent-electron CLI — parse arguments, dispatch to daemon, format output.
 */

import { Command as Commander } from 'commander';
import { sendCommand } from './client.js';
import { generateId } from './protocol.js';
import type { Command, Response, DEFAULT_TIMEOUTS } from './types.js';

const program = new Commander();

program
  .name('agent-electron')
  .description('Electron app automation CLI for AI agents')
  .version('0.1.0');

// Global options
let jsonOutput = false;
let globalTimeout: number | undefined;

program
  .option('--json', 'JSON output')
  .option('--timeout <ms>', 'Override default timeout', parseInt)
  .option('--debug', 'Debug output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    jsonOutput = !!opts.json;
    globalTimeout = opts.timeout;
  });

// --- launch ---
program
  .command('launch [path]')
  .description('Launch an Electron app')
  .option('-e, --executable-path <path>', 'Path to a pre-built Electron executable (.app, .exe, binary)')
  .argument('[args...]', 'Additional arguments')
  .action(async (appPath: string | undefined, args: string[], opts) => {
    await run({
      id: generateId(), action: 'launch',
      path: appPath || '',
      args,
      executablePath: opts.executablePath,
      timeout: globalTimeout || 30000,
    });
  });

// --- connect ---
program
  .command('connect <port>')
  .description('Connect to a running Electron app via CDP')
  .action(async (port: string) => {
    await run({ id: generateId(), action: 'connect', port: parseInt(port, 10), timeout: globalTimeout || 10000 });
  });

// --- close ---
program
  .command('close')
  .description('Close the app and daemon')
  .action(async () => {
    await run({ id: generateId(), action: 'close', timeout: globalTimeout || 5000 });
  });

// --- snapshot ---
program
  .command('snapshot')
  .description('Get accessibility tree with element refs')
  .option('-i, --interactive', 'Interactive elements only')
  .option('-c, --compact', 'Remove empty structural elements')
  .option('-d, --depth <n>', 'Maximum depth', parseInt)
  .option('-s, --selector <sel>', 'Scope to CSS selector')
  .action(async (opts) => {
    await run({
      id: generateId(), action: 'snapshot',
      interactive: opts.interactive, compact: opts.compact,
      depth: opts.depth, selector: opts.selector,
      timeout: globalTimeout || 10000,
    });
  });

// --- click ---
program
  .command('click [target]')
  .description('Click an element (@ref, selector, or --text label)')
  .option('-t, --text <label>', 'Click by visible text label (case-insensitive, exact match)')
  .option('--retries <n>', 'Retry attempts for --text (default 10)', parseInt)
  .option('--retry-delay <ms>', 'Delay between retries in ms (default 150)', parseInt)
  .option('--scope-selector <selector>', 'Scope text search to a container or iframe matching this CSS selector')
  .action(async (target: string | undefined, opts: { text?: string; retries?: number; retryDelay?: number; scopeSelector?: string }) => {
    const cmd: any = { id: generateId(), action: 'click', timeout: globalTimeout || 5000 };
    if (opts.text) {
      cmd.text = opts.text;
      if (opts.retries !== undefined) cmd.retries = opts.retries;
      if (opts.retryDelay !== undefined) cmd.retryDelay = opts.retryDelay;
      if (opts.scopeSelector !== undefined) cmd.scopeSelector = opts.scopeSelector;
    } else if (target) {
      cmd.target = target;
    }
    await run(cmd);
  });

// --- fill ---
program
  .command('fill <target> <text>')
  .description('Clear and fill an input')
  .action(async (target: string, text: string) => {
    await run({ id: generateId(), action: 'fill', target, value: text, timeout: globalTimeout || 5000 });
  });

// --- type ---
program
  .command('type <target> <text>')
  .description('Type text key-by-key')
  .action(async (target: string, text: string) => {
    await run({ id: generateId(), action: 'type', target, text, timeout: globalTimeout || 5000 });
  });

// --- press ---
program
  .command('press <key>')
  .description('Press a keyboard key (Enter, Tab, Escape, etc.)')
  .action(async (key: string) => {
    await run({ id: generateId(), action: 'press', key, timeout: globalTimeout || 5000 });
  });

// --- select ---
program
  .command('select <target> <value>')
  .description('Select a dropdown option')
  .action(async (target: string, value: string) => {
    await run({ id: generateId(), action: 'select', target, value, timeout: globalTimeout || 5000 });
  });

// --- check ---
program
  .command('check <target>')
  .description('Check a checkbox')
  .action(async (target: string) => {
    await run({ id: generateId(), action: 'check', target, timeout: globalTimeout || 5000 });
  });

// --- hover ---
program
  .command('hover <target>')
  .description('Hover over an element')
  .action(async (target: string) => {
    await run({ id: generateId(), action: 'hover', target, timeout: globalTimeout || 5000 });
  });

// --- scroll ---
program
  .command('scroll <direction> [amount]')
  .description('Scroll (up/down/left/right)')
  .action(async (direction: string, amount?: string) => {
    await run({
      id: generateId(), action: 'scroll',
      direction: direction as any,
      amount: amount ? parseInt(amount, 10) : undefined,
      timeout: globalTimeout || 5000,
    });
  });

// --- eval ---
program
  .command('eval <script>')
  .description('Run JavaScript in the renderer')
  .action(async (script: string) => {
    await run({ id: generateId(), action: 'eval', script, timeout: globalTimeout || 10000 });
  });

// --- eval-main ---
program
  .command('eval-main <script>')
  .description('Run JavaScript in the Electron main process')
  .action(async (script: string) => {
    await run({ id: generateId(), action: 'eval-main', script, timeout: globalTimeout || 10000 });
  });

// --- screenshot ---
program
  .command('screenshot [path]')
  .description('Take a screenshot')
  .option('-f, --full', 'Full page screenshot')
  .action(async (screenshotPath: string | undefined, opts) => {
    await run({
      id: generateId(), action: 'screenshot',
      path: screenshotPath, fullPage: opts.full,
      timeout: globalTimeout || 10000,
    });
  });

// --- get ---
const getCmd = program.command('get').description('Get information');

getCmd
  .command('text <target>')
  .description('Get text content of an element')
  .action(async (target: string) => {
    await run({ id: generateId(), action: 'get-text', target, timeout: globalTimeout || 5000 });
  });

getCmd
  .command('value <target>')
  .description('Get input value')
  .action(async (target: string) => {
    await run({ id: generateId(), action: 'get-value', target, timeout: globalTimeout || 5000 });
  });

getCmd
  .command('title')
  .description('Get window title')
  .action(async () => {
    await run({ id: generateId(), action: 'get-title', timeout: globalTimeout || 5000 });
  });

getCmd
  .command('url')
  .description('Get current URL')
  .action(async () => {
    await run({ id: generateId(), action: 'get-url', timeout: globalTimeout || 5000 });
  });

// --- is ---
program
  .command('is-visible <target>')
  .description('Check if element is visible')
  .action(async (target: string) => {
    await run({ id: generateId(), action: 'is-visible', target, timeout: globalTimeout || 5000 });
  });

// --- wait ---
program
  .command('wait [target]')
  .description('Wait for element, time, text, or condition')
  .option('--text <text>', 'Wait for text to appear')
  .option('--gone <selector>', 'Wait for element to disappear')
  .option('--fn <expression>', 'Wait for JS condition')
  .action(async (target: string | undefined, opts) => {
    const cmd: any = { id: generateId(), action: 'wait', timeout: globalTimeout || 30000 };

    if (opts.text) cmd.text = opts.text;
    else if (opts.gone) cmd.gone = opts.gone;
    else if (opts.fn) cmd.fn = opts.fn;
    else if (target && /^\d+$/.test(target)) cmd.ms = parseInt(target, 10);
    else if (target) cmd.target = target;

    await run(cmd);
  });

// --- window ---
const winCmd = program.command('window').description('Window management');

winCmd
  .command('list')
  .description('List all windows')
  .action(async () => {
    await run({ id: generateId(), action: 'window-list', timeout: globalTimeout || 5000 });
  });

winCmd
  .command('switch <index>')
  .description('Switch to window by index')
  .action(async (index: string) => {
    await run({ id: generateId(), action: 'window-switch', index: parseInt(index, 10), timeout: globalTimeout || 5000 });
  });

// --- frame ---
const frameCmd = program.command('frame').description('Frame/iframe management');

frameCmd
  .command('list')
  .description('List all frames in the active window')
  .action(async () => {
    await run({ id: generateId(), action: 'frame-list', timeout: globalTimeout || 5000 });
  });

frameCmd
  .command('switch <index>')
  .description('Switch to a frame by index')
  .action(async (index: string) => {
    await run({ id: generateId(), action: 'frame-switch', index: parseInt(index, 10), timeout: globalTimeout || 5000 });
  });

frameCmd
  .command('reset')
  .description('Switch back to the main frame')
  .action(async () => {
    await run({ id: generateId(), action: 'frame-reset', timeout: globalTimeout || 5000 });
  });

// --- editor (Monaco / contenteditable) ---
const editorCmd = program.command('editor').description('Monaco and contenteditable editor interaction');

editorCmd
  .command('set <target> <text>')
  .description('Set text in a Monaco or contenteditable editor (clear + type, with verification)')
  .option('--scope-selector <selector>', 'Scope editor lookup to a container or iframe matching this CSS selector')
  .action(async (target: string, text: string, opts: { scopeSelector?: string }) => {
    const cmd: any = { id: generateId(), action: 'editor-set', target, text, timeout: globalTimeout || 10000 };
    if (opts.scopeSelector !== undefined) cmd.scopeSelector = opts.scopeSelector;
    await run(cmd);
  });

editorCmd
  .command('get <target>')
  .description('Get visible text from a Monaco or contenteditable editor')
  .option('--scope-selector <selector>', 'Scope editor lookup to a container or iframe matching this CSS selector')
  .action(async (target: string, opts: { scopeSelector?: string }) => {
    const cmd: any = { id: generateId(), action: 'editor-get', target, timeout: globalTimeout || 5000 };
    if (opts.scopeSelector !== undefined) cmd.scopeSelector = opts.scopeSelector;
    await run(cmd);
  });

// --- target (CDP targets) ---
const targetCmd = program.command('target').description('CDP target management (for webviews)');

targetCmd
  .command('list')
  .description('List all CDP targets (pages and webview iframes)')
  .action(async () => {
    await run({ id: generateId(), action: 'target-list', timeout: globalTimeout || 5000 });
  });

targetCmd
  .command('switch [index]')
  .description('Switch to a CDP target by index or --match substring')
  .option('-m, --match <substring>', 'Match target by title/url substring (case-insensitive)')
  .option('--all', 'Print all matches without switching (discovery mode)')
  .action(async (index: string | undefined, opts: { match?: string; all?: boolean }) => {
    const cmd: any = { id: generateId(), action: 'target-switch', timeout: globalTimeout || 10000 };
    if (opts.match !== undefined) {
      cmd.match = opts.match;
      if (opts.all) cmd.all = true;
    } else if (index !== undefined) {
      cmd.index = parseInt(index, 10);
    }
    await run(cmd);
  });

// --- Run command and output ---
async function run(cmd: Command): Promise<void> {
  try {
    const response = await sendCommand(cmd);
    output(response);

    // Exit with error code if command failed
    if (!response.success) {
      process.exitCode = 1;
    }
  } catch (err: any) {
    const errResponse: Response = {
      success: false,
      error: 'daemon_error',
      message: err.message || String(err),
    };
    output(errResponse);
    process.exitCode = 1;
  }
}

function output(response: Response): void {
  if (jsonOutput) {
    console.log(JSON.stringify(response));
  } else {
    if (response.success) {
      const data = response.data;
      if ('snapshot' in data) {
        console.log(data.snapshot);
      } else if ('result' in data) {
        const val = data.result;
        console.log(typeof val === 'string' ? val : JSON.stringify(val, null, 2));
      } else if ('text' in data) {
        console.log(data.text);
      } else if ('value' in data) {
        console.log(data.value);
      } else if ('title' in data) {
        console.log(data.title);
      } else if ('url' in data) {
        console.log(data.url);
      } else if ('visible' in data) {
        console.log(data.visible);
      } else if ('path' in data) {
        console.log(`Screenshot saved: ${data.path}`);
      } else if ('windows' in data) {
        const windows = data.windows as Array<{ index: number; title: string; url: string }>;
        for (const w of windows) {
          console.log(`  ${w.index}: ${w.title} (${w.url})`);
        }
      } else if ('targets' in data) {
        const targets = data.targets as Array<{ index: number; type: string; title: string; url: string }>;
        for (const t of targets) {
          console.log(`  ${t.index}: [${t.type}] ${t.title} (${t.url.substring(0, 80)}${t.url.length > 80 ? '...' : ''})`);
        }
      } else if ('frames' in data) {
        const frames = data.frames as Array<{ index: number; name: string; url: string }>;
        for (const f of frames) {
          console.log(`  ${f.index}: ${f.name} (${f.url})`);
        }
      } else if ('name' in data && 'index' in data) {
        // frame-switch response
        console.log(`Switched to frame ${data.index}: ${data.name} (${data.url || ''})`);
      } else if (Object.keys(data).length === 0) {
        // Empty success — just confirm
        console.log('OK');
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
    } else {
      console.error(`Error [${response.error}]: ${response.message}`);
    }
  }
}

program.parse();

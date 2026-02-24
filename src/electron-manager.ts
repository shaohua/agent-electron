import { _electron, chromium, type ElectronApplication, type Page, type Frame, type Browser } from 'playwright-core';
import { WebSocket } from 'ws';
import type { RefMap, RefInfo } from './types.js';

export interface CDPTarget {
  index: number;
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

/** Minimal CDP session over raw WebSocket for iframe targets */
class RawCDPSession {
  private ws: WebSocket;
  private msgId = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    this.ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }

  async ready(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
  }

  async send(method: string, params: Record<string, any> = {}): Promise<any> {
    await this.ready();
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }

  close(): void {
    this.ws.close();
    for (const { reject } of this.pending.values()) {
      reject(new Error('Session closed'));
    }
    this.pending.clear();
  }
}

export class ElectronManager {
  private electronApp: ElectronApplication | null = null;
  private cdpBrowser: Browser | null = null;
  private cdpPort: number | null = null;
  private cdpSession: RawCDPSession | null = null; // for iframe targets
  private pages: Page[] = [];
  private activePageIndex = 0;
  private refs: RefMap = {};
  private activeFrame: Frame | null = null;

  get isRunning(): boolean {
    return this.electronApp !== null || this.cdpBrowser !== null;
  }

  get activePage(): Page | null {
    return this.pages[this.activePageIndex] || null;
  }

  get activeTarget(): Page | Frame | null {
    return this.activeFrame ?? this.activePage;
  }

  get refMap(): RefMap {
    return this.refs;
  }

  setRefs(refs: RefMap): void {
    this.refs = refs;
  }

  async launch(appPath: string, args: string[] = [], timeout = 30000, executablePath?: string): Promise<{ title: string; url: string }> {
    if (this.isRunning) {
      await this.close();
    }

    const launchOptions: Parameters<typeof _electron.launch>[0] = { timeout };
    if (executablePath) {
      launchOptions.executablePath = executablePath;
      launchOptions.args = [appPath, ...args].filter(Boolean);
    } else {
      launchOptions.args = [appPath, ...args];
    }

    this.electronApp = await _electron.launch(launchOptions);

    // Wait for first window
    const page = await this.electronApp.firstWindow();
    this.pages = [page];
    this.activePageIndex = 0;

    // Listen for new windows
    this.electronApp.on('window', (newPage: Page) => {
      this.pages.push(newPage);
    });

    // Wait a bit for the page to be ready
    await page.waitForLoadState('domcontentloaded').catch(() => {});

    return {
      title: await page.title(),
      url: page.url()
    };
  }

  async connect(port: number, timeout = 10000): Promise<{ title: string; url: string }> {
    if (this.isRunning) {
      await this.close();
    }

    this.cdpPort = port;
    this.cdpBrowser = await chromium.connectOverCDP(`http://localhost:${port}`, { timeout });
    const contexts = this.cdpBrowser.contexts();
    if (contexts.length === 0) {
      throw new Error('No browser contexts found');
    }
    // Collect pages from ALL contexts so webview targets are accessible
    this.pages = [];
    for (const ctx of contexts) {
      this.pages.push(...ctx.pages());
    }
    if (this.pages.length === 0) {
      throw new Error('No pages found');
    }
    this.activePageIndex = 0;

    return {
      title: await this.pages[0].title(),
      url: this.pages[0].url()
    };
  }

  getFrameList(): Array<{ index: number; name: string; url: string }> {
    const page = this.activePage;
    if (!page) return [];
    const frames = page.frames();
    return frames.map((f, i) => ({
      index: i,
      name: f.name() || (i === 0 ? '(main)' : '(anonymous)'),
      url: f.url(),
    }));
  }

  switchFrame(index: number): boolean {
    const page = this.activePage;
    if (!page) return false;
    const frames = page.frames();
    if (index < 0 || index >= frames.length) return false;
    this.activeFrame = frames[index];
    return true;
  }

  resetFrame(): void {
    this.activeFrame = null;
  }

  async getCDPTargets(): Promise<CDPTarget[]> {
    if (!this.cdpPort) return [];
    const resp = await fetch(`http://localhost:${this.cdpPort}/json/list`);
    const targets: any[] = await resp.json();
    return targets
      .filter(t => t.type === 'page' || t.type === 'iframe')
      .map((t, i) => ({
        index: i,
        id: t.id,
        type: t.type,
        title: t.title,
        url: t.url,
        webSocketDebuggerUrl: t.webSocketDebuggerUrl,
      }));
  }

  filterCDPTargets(targets: CDPTarget[], substring: string): CDPTarget[] {
    const needle = substring.toLowerCase();
    return targets.filter(t =>
      t.title.toLowerCase().includes(needle) ||
      t.url.toLowerCase().includes(needle)
    );
  }

  async switchToCDPTarget(index: number): Promise<{ title: string; url: string }> {
    const targets = await this.getCDPTargets();
    if (index < 0 || index >= targets.length) {
      throw new Error(`Target index ${index} out of range (0-${targets.length - 1})`);
    }
    const target = targets[index];

    // Clean up any previous CDP session
    if (this.cdpSession) {
      this.cdpSession.close();
      this.cdpSession = null;
    }

    // If switching to the main page, just reset
    if (target.type === 'page') {
      this.activePageIndex = 0;
      this.activeFrame = null;
      this.refs = {};
      return { title: target.title, url: target.url };
    }

    // For iframe targets, open a raw CDP session
    if (!target.webSocketDebuggerUrl) {
      throw new Error(`Target ${index} has no WebSocket debugger URL`);
    }
    this.cdpSession = new RawCDPSession(target.webSocketDebuggerUrl);
    await this.cdpSession.ready();
    this.refs = {};

    return { title: target.title, url: target.url };
  }

  get hasCDPSession(): boolean {
    return this.cdpSession !== null;
  }

  async evalCDP(expression: string): Promise<any> {
    if (!this.cdpSession) throw new Error('No CDP target session. Run: agent-electron target switch <index>');
    const result = await this.cdpSession.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result?.value;
  }

  async clickCDP(selector: string): Promise<void> {
    await this.evalCDP(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  }

  /**
   * Click an element by its visible text label within a CDP target.
   * Matching: case-insensitive, whitespace-normalized, exact text match.
   * Searches visible interactive elements (button, a, [role=button|tab|link]).
   * Fires pointerdown -> mousedown -> mouseup -> click.
   * Retries up to `retries` times with `retryDelay` ms between attempts.
   * On failure returns { clicked: false, visibleLabels: string[] } for debugging.
   *
   * When `scopeSelector` is provided, the search is scoped:
   *  - If the selector resolves to an iframe/frame, uses its contentDocument.
   *  - Otherwise, uses the matched element as a container root.
   *  - If the selector is not found or unusable, returns { clicked: false, scopeError: 'invalid_scope_selector' }.
   */
  async clickByTextCDP(
    label: string,
    retries: number = 10,
    retryDelay: number = 150,
    scopeSelector?: string,
  ): Promise<{ clicked: boolean; visibleLabels: string[]; scopeError?: string }> {
    if (!this.cdpSession) throw new Error('No CDP target session. Run: agent-electron target switch <index>');

    const scopeSelectorJSON = scopeSelector ? JSON.stringify(scopeSelector) : 'null';

    const script = `(async () => {
  const label = ${JSON.stringify(label)};
  const maxRetries = ${retries};
  const delay = ${retryDelay};
  const scopeSel = ${scopeSelectorJSON};
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const lower = (s) => norm(s).toLowerCase();
  const wanted = lower(label);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };

  // Resolve scope root
  let scopeRoot = document;
  if (scopeSel) {
    const scopeEl = document.querySelector(scopeSel);
    if (!scopeEl) {
      return JSON.stringify({ clicked: false, visibleLabels: [], scopeError: 'invalid_scope_selector' });
    }
    const tag = scopeEl.tagName.toLowerCase();
    if (tag === 'iframe' || tag === 'frame') {
      try {
        const doc = scopeEl.contentDocument;
        if (!doc) {
          return JSON.stringify({ clicked: false, visibleLabels: [], scopeError: 'scope_not_accessible' });
        }
        scopeRoot = doc;
      } catch (e) {
        return JSON.stringify({ clicked: false, visibleLabels: [], scopeError: 'scope_not_accessible' });
      }
    } else {
      scopeRoot = scopeEl;
    }
  }

  const interactiveSelector = 'button,a,[role="tab"],[role="link"],[role="button"]';

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const allEls = [...scopeRoot.querySelectorAll(interactiveSelector + ',div,span,li')];
    const candidates = allEls
      .map((el) => el.matches(interactiveSelector) ? el : el.closest(interactiveSelector))
      .filter((el, idx, arr) => !!el && arr.indexOf(el) === idx);

    const match = candidates.find((el) => lower(el.textContent) === wanted && visible(el));
    if (match) {
      for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
        match.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      return JSON.stringify({ clicked: true, visibleLabels: [] });
    }
    if (attempt < maxRetries - 1) await sleep(delay);
  }

  const allEls = [...scopeRoot.querySelectorAll(interactiveSelector)];
  const visibleLabels = allEls
    .filter((el) => visible(el))
    .map((el) => norm(el.textContent))
    .filter(Boolean);
  const unique = [...new Set(visibleLabels)].slice(0, 30);
  return JSON.stringify({ clicked: false, visibleLabels: unique });
})()`;

    const raw = await this.evalCDP(script);
    try {
      return JSON.parse(raw);
    } catch {
      return { clicked: false, visibleLabels: [] };
    }
  }

  /**
   * Get text content from a Monaco or contenteditable editor via CDP.
   * Monaco: reads visible rendered text from .view-line elements.
   * Contenteditable: reads rendered text content.
   * Returns { ok, text, editorType } or { ok: false, reason }.
   */
  async editorGetCDP(selector: string, scopeSelector?: string): Promise<{ ok: boolean; text: string; editorType: string; reason?: string }> {
    if (!this.cdpSession) throw new Error('No CDP target session. Run: agent-electron target switch <index>');

    const scopeSelectorJSON = scopeSelector ? JSON.stringify(scopeSelector) : 'null';

    const script = `(() => {
  const scopeSel = ${scopeSelectorJSON};

  // Resolve scope root
  let scopeRoot = document;
  if (scopeSel) {
    const scopeEl = document.querySelector(scopeSel);
    if (!scopeEl) {
      return JSON.stringify({ ok: false, text: '', editorType: 'none', reason: 'invalid_scope_selector' });
    }
    const tag = scopeEl.tagName.toLowerCase();
    if (tag === 'iframe' || tag === 'frame') {
      try {
        const doc = scopeEl.contentDocument;
        if (!doc) {
          return JSON.stringify({ ok: false, text: '', editorType: 'none', reason: 'scope_not_accessible' });
        }
        scopeRoot = doc;
      } catch (e) {
        return JSON.stringify({ ok: false, text: '', editorType: 'none', reason: 'scope_not_accessible' });
      }
    } else {
      scopeRoot = scopeEl;
    }
  }

  const target = scopeRoot.querySelector(${JSON.stringify(selector)});
  if (!target) return JSON.stringify({ ok: false, text: '', editorType: 'none', reason: 'target_not_found' });

  const norm = (s) => (s || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();

  // Monaco editor: look for .view-lines inside or around the target
  const monacoContainer = target.closest('.monaco-editor') || target.querySelector('.monaco-editor');
  if (monacoContainer) {
    const viewLines = [...monacoContainer.querySelectorAll('.view-lines .view-line')];
    const text = viewLines.map((el) => el.textContent || '').join('\\n');
    return JSON.stringify({ ok: true, text: norm(text), editorType: 'monaco' });
  }

  // Contenteditable editor
  if (target.getAttribute('contenteditable') === 'true' || target.isContentEditable) {
    return JSON.stringify({ ok: true, text: norm(target.textContent || ''), editorType: 'contenteditable' });
  }

  // Try to find a Monaco or contenteditable inside the target
  const innerCE = target.querySelector('[contenteditable="true"]');
  if (innerCE) {
    return JSON.stringify({ ok: true, text: norm(innerCE.textContent || ''), editorType: 'contenteditable' });
  }

  return JSON.stringify({ ok: false, text: '', editorType: 'unknown', reason: 'no_supported_editor_found' });
})()`;

    const raw = await this.evalCDP(script);
    try {
      return JSON.parse(raw);
    } catch {
      return { ok: false, text: '', editorType: 'unknown', reason: 'parse_error' };
    }
  }

  /**
   * Set text in a Monaco or contenteditable editor via CDP.
   * Strategy: focus target, select all (Ctrl/Cmd+A), delete, type key-by-key.
   * Verifies result with editorGetCDP. Retries up to 3 total attempts.
   * Returns { ok, actualText, editorType, attempts } or { ok: false, reason, actualText }.
   */
  async editorSetCDP(
    selector: string,
    text: string,
    scopeSelector?: string,
  ): Promise<{ ok: boolean; actualText: string; editorType: string; attempts: number; reason?: string }> {
    if (!this.cdpSession) throw new Error('No CDP target session. Run: agent-electron target switch <index>');

    const scopeSelectorJSON = scopeSelector ? JSON.stringify(scopeSelector) : 'null';
    const norm = (s: string) => s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const expected = norm(text);

    for (let attempt = 1; attempt <= 3; attempt++) {
      // Focus and clear via CDP
      const focusScript = `(() => {
  const scopeSel = ${scopeSelectorJSON};

  // Resolve scope root
  let scopeRoot = document;
  if (scopeSel) {
    const scopeEl = document.querySelector(scopeSel);
    if (!scopeEl) {
      return JSON.stringify({ ok: false, reason: 'invalid_scope_selector' });
    }
    const tag = scopeEl.tagName.toLowerCase();
    if (tag === 'iframe' || tag === 'frame') {
      try {
        const doc = scopeEl.contentDocument;
        if (!doc) {
          return JSON.stringify({ ok: false, reason: 'scope_not_accessible' });
        }
        scopeRoot = doc;
      } catch (e) {
        return JSON.stringify({ ok: false, reason: 'scope_not_accessible' });
      }
    } else {
      scopeRoot = scopeEl;
    }
  }

  const target = scopeRoot.querySelector(${JSON.stringify(selector)});
  if (!target) return JSON.stringify({ ok: false, reason: 'target_not_found' });

  // Find the focusable element
  const monaco = target.closest('.monaco-editor') || target.querySelector('.monaco-editor');
  const textarea = monaco?.querySelector('textarea.inputarea');
  const ce = target.getAttribute?.('contenteditable') === 'true' ? target :
             target.querySelector?.('[contenteditable="true"]');
  const focusEl = textarea || ce || target;

  // Scroll into view and click to focus
  target.scrollIntoView?.({ block: 'center' });
  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
  focusEl.focus();

  return JSON.stringify({ ok: true, editorType: monaco ? 'monaco' : (ce ? 'contenteditable' : 'unknown') });
})()`;

      const focusRaw = await this.evalCDP(focusScript);
      let focusResult: any;
      try { focusResult = JSON.parse(focusRaw); } catch { focusResult = { ok: false }; }
      if (!focusResult.ok) {
        return { ok: false, actualText: '', editorType: 'unknown', attempts: attempt, reason: focusResult.reason || 'focus_failed' };
      }

      // Select all + delete to clear
      const isMac = await this.evalCDP(`navigator.platform.startsWith('Mac')`);
      const modifiers = isMac ? 4 : 2; // 4 = Meta, 2 = Ctrl
      await this.cdpSession!.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers });
      await this.cdpSession!.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers });
      await this.cdpSession!.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace' });
      await this.cdpSession!.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace' });

      // Small delay for the editor to process
      await this.evalCDP('new Promise(r => setTimeout(r, 50))');

      // Type key by key
      for (const ch of text) {
        if (ch === '\n') {
          await this.cdpSession!.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' });
          await this.cdpSession!.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' });
        } else {
          await this.cdpSession!.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch });
          await this.cdpSession!.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
        }
      }

      // Small delay then verify
      await this.evalCDP('new Promise(r => setTimeout(r, 100))');
      const readResult = await this.editorGetCDP(selector, scopeSelector);
      const actualNorm = norm(readResult.text);

      if (actualNorm === expected) {
        return { ok: true, actualText: readResult.text, editorType: readResult.editorType, attempts: attempt };
      }

      // Delay before retry
      if (attempt < 3) {
        await this.evalCDP('new Promise(r => setTimeout(r, 200))');
      } else {
        return {
          ok: false,
          actualText: readResult.text,
          editorType: readResult.editorType,
          attempts: attempt,
          reason: 'text_mismatch_after_retries',
        };
      }
    }

    return { ok: false, actualText: '', editorType: 'unknown', attempts: 3, reason: 'unexpected' };
  }

  async fillCDP(selector: string, value: string): Promise<void> {
    await this.evalCDP(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found: ${selector}');
      el.focus();
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  }

  async snapshotCDP(): Promise<string> {
    const result = await this.cdpSession!.send('Accessibility.getFullAXTree');
    if (!result.nodes) return '(no accessibility tree)';
    const lines: string[] = [];
    const nodeMap = new Map<string, any>();
    for (const node of result.nodes) {
      nodeMap.set(node.nodeId, node);
    }
    function walk(nodeId: string, depth: number) {
      const node = nodeMap.get(nodeId);
      if (!node) return;
      const role = node.role?.value || '';
      const name = node.name?.value || '';
      if (role && role !== 'none' && role !== 'generic') {
        const indent = '  '.repeat(depth);
        lines.push(`${indent}- ${role}${name ? ` "${name}"` : ''}`);
      }
      if (node.childIds) {
        for (const childId of node.childIds) {
          walk(childId, depth + (role && role !== 'none' && role !== 'generic' ? 1 : 0));
        }
      }
    }
    if (result.nodes.length > 0) {
      walk(result.nodes[0].nodeId, 0);
    }
    return lines.join('\n') || '(empty)';
  }

  async close(): Promise<void> {
    if (this.electronApp) {
      try {
        await this.electronApp.close();
      } catch {
        // Ignore close errors
      }
      this.electronApp = null;
    }
    if (this.cdpBrowser) {
      try {
        await this.cdpBrowser.close();
      } catch {
        // Ignore
      }
      this.cdpBrowser = null;
    }
    if (this.cdpSession) {
      this.cdpSession.close();
      this.cdpSession = null;
    }
    this.pages = [];
    this.activePageIndex = 0;
    this.refs = {};
    this.activeFrame = null;
    this.cdpPort = null;
  }

  getPages(): Array<{ index: number; title: string; url: string }> {
    return this.pages.map((p, i) => ({
      index: i,
      title: '', // Will be filled async
      url: p.url()
    }));
  }

  async getWindowList(): Promise<Array<{ index: number; title: string; url: string }>> {
    const result: Array<{ index: number; title: string; url: string }> = [];
    for (let i = 0; i < this.pages.length; i++) {
      try {
        result.push({
          index: i,
          title: await this.pages[i].title(),
          url: this.pages[i].url()
        });
      } catch {
        result.push({ index: i, title: '(closed)', url: '' });
      }
    }
    return result;
  }

  switchWindow(index: number): boolean {
    if (index >= 0 && index < this.pages.length) {
      this.activePageIndex = index;
      return true;
    }
    return false;
  }

  async evalMain(script: string): Promise<unknown> {
    if (!this.electronApp) {
      throw new Error('eval-main requires launch mode (not connect)');
    }
    // ElectronApplication.evaluate receives a function whose first arg is the
    // `require('electron')` module from the main process.
    // We use Function constructor to eval the script with access to `electron`.
    return await this.electronApp.evaluate(
      (electron, scriptStr) => {
        // Make common electron APIs available
        const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, session, nativeTheme } = electron;
        const require_fn = (globalThis as any).require || ((m: string) => {
          if (m === 'electron') return electron;
          throw new Error(`Cannot require '${m}' in eval-main`);
        });
        const fn = new Function('require', 'electron', 'app', 'BrowserWindow', 'ipcMain', 'dialog', 'Menu', 'Tray', 'session', 'nativeTheme',
          `return (${scriptStr})`
        );
        return fn(require_fn, electron, app, BrowserWindow, ipcMain, dialog, Menu, Tray, session, nativeTheme);
      },
      script
    );
  }

  resolveTarget(target: string): { selector: string; nth: number } {
    if (target.startsWith('@')) {
      const refId = target.slice(1);
      const ref = this.refs[refId];
      if (!ref) {
        throw new Error(`Ref ${target} not found. Run snapshot to get current refs.`);
      }
      return { selector: ref.selector, nth: ref.nth ?? 0 };
    }
    return { selector: target, nth: 0 };
  }
}

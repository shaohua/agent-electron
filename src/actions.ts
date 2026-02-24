/**
 * Command execution — all interactions with the Electron app.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import type { Page, Frame } from 'playwright-core';
import { ElectronManager } from './electron-manager.js';
import { getSnapshot, type SnapshotOptions } from './snapshot.js';
import { successResponse, errorResponse } from './protocol.js';
import type { Command, Response, DEFAULT_TIMEOUTS } from './types.js';

export async function executeCommand(
  cmd: Command,
  manager: ElectronManager
): Promise<Response> {
  const timeout = cmd.timeout || 5000;

  try {
    switch (cmd.action) {
      case 'launch': {
        const data = await manager.launch(cmd.path, cmd.args, cmd.timeout || 30000, cmd.executablePath);
        return successResponse(data as any);
      }

      case 'connect': {
        const data = await manager.connect(cmd.port, cmd.timeout || 10000);
        return successResponse(data as any);
      }

      case 'close': {
        await manager.close();
        return successResponse({});
      }

      case 'snapshot': {
        // CDP target mode: use raw CDP accessibility tree
        if (manager.hasCDPSession) {
          const snapshot = await manager.snapshotCDP();
          return successResponse({ snapshot, refs: {} } as any);
        }
        const target = requireTarget(manager);
        const options: SnapshotOptions = {
          interactive: cmd.interactive,
          compact: cmd.compact,
          maxDepth: cmd.depth,
          selector: cmd.selector,
        };
        const result = await getSnapshot(target, options);
        manager.setRefs(result.refs);
        return successResponse({ snapshot: result.tree, refs: result.refs } as any);
      }

      case 'click': {
        // click --text "<label>" path
        if (cmd.text) {
          if (!manager.hasCDPSession) {
            // Playwright path: use text selector, with optional scope
            const target = requireTarget(manager);
            const interactiveSelector = 'button, a, [role="button"], [role="tab"], [role="link"]';
            let root = target.locator(interactiveSelector);
            if (cmd.scopeSelector) {
              // Scope to container — Playwright handles iframes via frameLocator
              const scopeEl = target.locator(cmd.scopeSelector).first();
              const tag = await scopeEl.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
              if (!tag) {
                return errorResponse('invalid_scope_selector', `Scope selector not found: ${cmd.scopeSelector}`);
              }
              if (tag === 'iframe' || tag === 'frame') {
                root = target.frameLocator(cmd.scopeSelector).locator(interactiveSelector);
              } else {
                root = scopeEl.locator(interactiveSelector);
              }
            }
            const locator = root.filter({ hasText: cmd.text });
            await locator.first().click({ timeout });
            return successResponse({});
          }
          const result = await manager.clickByTextCDP(
            cmd.text,
            cmd.retries ?? 10,
            cmd.retryDelay ?? 150,
            cmd.scopeSelector,
          );
          if (result.scopeError) {
            const code = result.scopeError === 'scope_not_accessible' ? 'scope_not_accessible' : 'invalid_scope_selector';
            const msg = result.scopeError === 'scope_not_accessible'
              ? `Scope element not accessible (no contentDocument or cross-origin): ${cmd.scopeSelector}`
              : `Scope selector not found: ${cmd.scopeSelector}`;
            return errorResponse(code, msg);
          }
          if (!result.clicked) {
            const scopeNote = cmd.scopeSelector ? ` (scoped to "${cmd.scopeSelector}")` : '';
            const labelList = result.visibleLabels.length > 0
              ? result.visibleLabels.map(l => `  - ${l}`).join('\n')
              : '  (none found)';
            return errorResponse(
              'element_not_found',
              `No visible interactive element with text "${cmd.text}"${scopeNote}. Top visible labels:\n${labelList}`
            );
          }
          return successResponse({});
        }

        if (!cmd.target) {
          return errorResponse('invalid_command', 'click requires <target> or --text <label>');
        }
        if (manager.hasCDPSession) {
          await manager.clickCDP(cmd.target);
          return successResponse({});
        }
        const target = requireTarget(manager);
        const { selector, nth } = manager.resolveTarget(cmd.target);
        await target.locator(selector).nth(nth).click({ timeout });
        return successResponse({});
      }

      case 'fill': {
        if (manager.hasCDPSession) {
          await manager.fillCDP(cmd.target, cmd.value);
          return successResponse({});
        }
        const target = requireTarget(manager);
        const { selector, nth } = manager.resolveTarget(cmd.target);
        await target.locator(selector).nth(nth).fill(cmd.value, { timeout });
        return successResponse({});
      }

      case 'type': {
        const target = requireTarget(manager);
        const { selector, nth } = manager.resolveTarget(cmd.target);
        await target.locator(selector).nth(nth).pressSequentially(cmd.text, { timeout, delay: 50 });
        return successResponse({});
      }

      case 'press': {
        const page = requirePage(manager);
        await page.keyboard.press(cmd.key);
        return successResponse({});
      }

      case 'select': {
        const target = requireTarget(manager);
        const { selector, nth } = manager.resolveTarget(cmd.target);
        await target.locator(selector).nth(nth).selectOption(cmd.value, { timeout });
        return successResponse({});
      }

      case 'check': {
        const target = requireTarget(manager);
        const { selector, nth } = manager.resolveTarget(cmd.target);
        await target.locator(selector).nth(nth).check({ timeout });
        return successResponse({});
      }

      case 'hover': {
        const target = requireTarget(manager);
        const { selector, nth } = manager.resolveTarget(cmd.target);
        await target.locator(selector).nth(nth).hover({ timeout });
        return successResponse({});
      }

      case 'scroll': {
        const page = requirePage(manager);
        const amount = cmd.amount || 300;
        const deltaX = cmd.direction === 'left' ? -amount : cmd.direction === 'right' ? amount : 0;
        const deltaY = cmd.direction === 'up' ? -amount : cmd.direction === 'down' ? amount : 0;
        await page.mouse.wheel(deltaX, deltaY);
        return successResponse({});
      }

      case 'eval': {
        if (manager.hasCDPSession) {
          const result = await manager.evalCDP(cmd.script);
          return successResponse({ result } as any);
        }
        const target = requireTarget(manager);
        const result = await target.evaluate(cmd.script);
        return successResponse({ result } as any);
      }

      case 'eval-main': {
        const result = await manager.evalMain(cmd.script);
        return successResponse({ result } as any);
      }

      case 'screenshot': {
        const page = requirePage(manager);
        const screenshotPath = cmd.path || `/tmp/agent-electron-screenshot-${Date.now()}.png`;
        const dir = dirname(resolve(screenshotPath));
        mkdirSync(dir, { recursive: true });
        await page.screenshot({
          path: resolve(screenshotPath),
          fullPage: cmd.fullPage || false,
          timeout: cmd.timeout || 10000,
        });
        return successResponse({ path: resolve(screenshotPath) } as any);
      }

      case 'get-text': {
        const target = requireTarget(manager);
        const { selector, nth } = manager.resolveTarget(cmd.target);
        const text = await target.locator(selector).nth(nth).textContent({ timeout });
        return successResponse({ text: text || '' } as any);
      }

      case 'get-value': {
        const target = requireTarget(manager);
        const { selector, nth } = manager.resolveTarget(cmd.target);
        const value = await target.locator(selector).nth(nth).inputValue({ timeout });
        return successResponse({ value } as any);
      }

      case 'get-title': {
        const page = requirePage(manager);
        const title = await page.title();
        return successResponse({ title } as any);
      }

      case 'get-url': {
        const target = requireTarget(manager);
        return successResponse({ url: target.url() } as any);
      }

      case 'is-visible': {
        const target = requireTarget(manager);
        const { selector, nth } = manager.resolveTarget(cmd.target);
        const visible = await target.locator(selector).nth(nth).isVisible();
        return successResponse({ visible } as any);
      }

      case 'wait': {
        const target = requireTarget(manager);
        const waitTimeout = cmd.timeout || 30000;

        if (cmd.ms) {
          // waitForTimeout is Page-only; use a simple delay for frames
          const page = requirePage(manager);
          await page.waitForTimeout(cmd.ms);
          return successResponse({});
        }

        if (cmd.text) {
          await target.locator(`text=${cmd.text}`).first().waitFor({ state: 'visible', timeout: waitTimeout });
          return successResponse({});
        }

        if (cmd.gone) {
          const { selector, nth } = manager.resolveTarget(cmd.gone);
          await target.locator(selector).nth(nth).waitFor({ state: 'hidden', timeout: waitTimeout });
          return successResponse({});
        }

        if (cmd.fn) {
          await target.waitForFunction(cmd.fn, undefined, { timeout: waitTimeout });
          return successResponse({});
        }

        if (cmd.target) {
          const { selector, nth } = manager.resolveTarget(cmd.target);
          await target.locator(selector).nth(nth).waitFor({ state: 'visible', timeout: waitTimeout });
          return successResponse({});
        }

        return errorResponse('invalid_command', 'wait requires a target, --ms, --text, --gone, or --fn');
      }

      case 'window-list': {
        const windows = await manager.getWindowList();
        return successResponse({ windows } as any);
      }

      case 'window-switch': {
        const ok = manager.switchWindow(cmd.index);
        if (!ok) {
          return errorResponse('invalid_command', `Window index ${cmd.index} out of range`);
        }
        manager.resetFrame(); // Reset frame when switching windows
        const page = manager.activePage!;
        return successResponse({ index: cmd.index, title: await page.title(), url: page.url() } as any);
      }

      case 'frame-list': {
        requirePage(manager); // Ensure app is running
        const frames = manager.getFrameList();
        return successResponse({ frames } as any);
      }

      case 'frame-switch': {
        requirePage(manager); // Ensure app is running
        const ok = manager.switchFrame(cmd.index);
        if (!ok) {
          return errorResponse('invalid_command', `Frame index ${cmd.index} out of range`);
        }
        const frames = manager.getFrameList();
        const frameInfo = frames[cmd.index];
        return successResponse({ index: cmd.index, name: frameInfo?.name || '', url: frameInfo?.url || '' } as any);
      }

      case 'frame-reset': {
        manager.resetFrame();
        return successResponse({});
      }

      case 'editor-get': {
        if (!manager.hasCDPSession) {
          return errorResponse('invalid_command', 'editor get requires an active CDP target session');
        }
        const result = await manager.editorGetCDP(cmd.target, cmd.scopeSelector);
        if (result.reason === 'invalid_scope_selector') {
          return errorResponse('invalid_scope_selector', `Scope selector not found: ${cmd.scopeSelector}`);
        }
        if (result.reason === 'scope_not_accessible') {
          return errorResponse('scope_not_accessible', `Scope element not accessible (no contentDocument or cross-origin): ${cmd.scopeSelector}`);
        }
        if (!result.ok) {
          return errorResponse('element_not_found', `editor get failed: ${result.reason}`);
        }
        return successResponse({ text: result.text, editorType: result.editorType } as any);
      }

      case 'editor-set': {
        if (!manager.hasCDPSession) {
          return errorResponse('invalid_command', 'editor set requires an active CDP target session');
        }
        const result = await manager.editorSetCDP(cmd.target, cmd.text, cmd.scopeSelector);
        if (result.reason === 'invalid_scope_selector') {
          return errorResponse('invalid_scope_selector', `Scope selector not found: ${cmd.scopeSelector}`);
        }
        if (result.reason === 'scope_not_accessible') {
          return errorResponse('scope_not_accessible', `Scope element not accessible (no contentDocument or cross-origin): ${cmd.scopeSelector}`);
        }
        if (!result.ok) {
          return errorResponse(
            'element_not_found',
            `editor set failed after ${result.attempts} attempt(s): ${result.reason}. Actual text: ${JSON.stringify(result.actualText)}`
          );
        }
        return successResponse({ text: result.actualText, editorType: result.editorType, attempts: result.attempts } as any);
      }

      case 'target-list': {
        const targets = await manager.getCDPTargets();
        return successResponse({ targets } as any);
      }

      case 'target-switch': {
        if (cmd.match !== undefined) {
          const targets = await manager.getCDPTargets();
          const matches = manager.filterCDPTargets(targets, cmd.match);

          if (cmd.all) {
            return successResponse({ targets: matches } as any);
          }

          if (matches.length === 0) {
            const candidates = targets.map(t => `  ${t.index}: [${t.type}] ${t.title} (${t.url})`).join('\n');
            return errorResponse(
              'element_not_found',
              `No target matching "${cmd.match}". Available targets:\n${candidates}`
            );
          }

          const chosen = matches[0];
          const data = await manager.switchToCDPTarget(chosen.index);
          const extra = matches.length > 1 ? ` (matched ${matches.length} targets, picked first)` : '';
          return successResponse({ ...data, matched: matches.length, message: `Switched to target ${chosen.index}${extra}` } as any);
        }

        if (cmd.index === undefined) {
          return errorResponse('invalid_command', 'target switch requires <index> or --match <substring>');
        }
        const data = await manager.switchToCDPTarget(cmd.index);
        return successResponse(data as any);
      }

      default:
        return errorResponse('invalid_command', `Unknown action: ${(cmd as any).action}`);
    }
  } catch (err: any) {
    const msg = err.message || String(err);

    // Classify errors
    if (msg.includes('Target closed') || msg.includes('has been closed')) {
      return errorResponse('app_not_running', 'App window was closed. Run launch or connect.');
    }
    if (msg.includes('not found') || msg.includes('Ref @')) {
      return errorResponse('element_not_found', msg);
    }
    if (msg.includes('not visible') || msg.includes('not interactable')) {
      return errorResponse('element_not_visible', msg);
    }
    if (msg.includes('Timeout') || msg.includes('timeout') || msg.includes('exceeded')) {
      return errorResponse('timeout', msg);
    }
    if (cmd.action === 'eval' || cmd.action === 'eval-main') {
      return errorResponse('eval_error', msg);
    }
    if (cmd.action === 'launch') {
      return errorResponse('launch_failed', msg);
    }
    if (cmd.action === 'connect') {
      return errorResponse('connection_failed', msg);
    }

    return errorResponse('daemon_error', msg);
  }
}

function requireTarget(manager: ElectronManager): Page | Frame {
  const target = manager.activeTarget;
  if (!target) {
    throw new Error('No app running. Run: agent-electron launch <path>');
  }
  return target;
}

function requirePage(manager: ElectronManager): Page {
  const page = manager.activePage;
  if (!page) {
    throw new Error('No app running. Run: agent-electron launch <path>');
  }
  return page;
}

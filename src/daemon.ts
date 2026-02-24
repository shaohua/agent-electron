/**
 * Daemon process — persistent Unix socket server that manages the Electron app.
 */

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { ElectronManager } from './electron-manager.js';
import { deserializeCommand, serializeResponse, errorResponse } from './protocol.js';
import { executeCommand } from './actions.js';

const APP_DIR = path.join(os.homedir(), '.agent-electron');
const SOCKET_PATH = path.join(APP_DIR, 'daemon.sock');
const PID_PATH = path.join(APP_DIR, 'daemon.pid');

export function getSocketPath(): string {
  return SOCKET_PATH;
}

export function getPidPath(): string {
  return PID_PATH;
}

export function isDaemonRunning(): boolean {
  if (!fs.existsSync(PID_PATH)) return false;
  try {
    const pid = parseInt(fs.readFileSync(PID_PATH, 'utf-8').trim(), 10);
    process.kill(pid, 0); // Check if process exists
    return true;
  } catch {
    // Stale PID file
    cleanup();
    return false;
  }
}

function cleanup(): void {
  try { fs.unlinkSync(SOCKET_PATH); } catch {}
  try { fs.unlinkSync(PID_PATH); } catch {}
}

export async function startDaemon(): Promise<void> {
  // Ensure app dir exists
  if (!fs.existsSync(APP_DIR)) {
    fs.mkdirSync(APP_DIR, { recursive: true });
  }

  // Clean up stale socket
  cleanup();

  const manager = new ElectronManager();
  let shouldExit = false;

  const server = net.createServer((conn) => {
    let buffer = '';

    conn.on('data', async (data) => {
      buffer += data.toString();

      // Process complete lines (newline-delimited JSON)
      while (buffer.includes('\n')) {
        const newlineIdx = buffer.indexOf('\n');
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);

        if (!line.trim()) continue;

        try {
          const cmd = deserializeCommand(line);

          // Special: close command shuts down daemon
          if (cmd.action === 'close') {
            const response = await executeCommand(cmd, manager);
            conn.write(serializeResponse(response));
            shouldExit = true;
            setTimeout(() => {
              cleanup();
              server.close();
              process.exit(0);
            }, 100);
            return;
          }

          const response = await executeCommand(cmd, manager);
          conn.write(serializeResponse(response));
        } catch (err: any) {
          conn.write(serializeResponse(errorResponse('daemon_error', err.message)));
        }
      }
    });

    conn.on('error', () => {
      // Client disconnected, ignore
    });
  });

  server.listen(SOCKET_PATH, () => {
    // Write PID file
    fs.writeFileSync(PID_PATH, String(process.pid));
    // Signal parent that daemon is ready (if spawned as child)
    if (process.send) {
      process.send('ready');
    }
  });

  server.on('error', (err) => {
    console.error('Daemon server error:', err.message);
    cleanup();
    process.exit(1);
  });

  // Cleanup on exit
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('exit', () => { cleanup(); });
}

// If this module is run directly (e.g. via fork() from client.ts), start the daemon.
// Use exact path comparison to avoid false positives when daemon.ts is merely
// imported by another module whose path happens to contain "daemon".
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  startDaemon();
}

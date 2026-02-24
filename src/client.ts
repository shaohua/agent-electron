/**
 * Client — connects to daemon via Unix socket, sends commands, receives responses.
 */

import * as net from 'net';
import * as fs from 'fs';
import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getSocketPath, getPidPath, isDaemonRunning } from './daemon.js';
import { serializeCommand, deserializeResponse } from './protocol.js';
import type { Command, Response } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function ensureDaemon(): Promise<void> {
  if (isDaemonRunning()) return;

  // Spawn daemon as a detached child process
  const daemonPath = join(__dirname, 'daemon.js');

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const child = fork(daemonPath, [], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Kill the child and detach so the parent event loop can exit
      try { child.kill(); } catch {}
      child.unref();
      try { child.disconnect(); } catch {}
      reject(new Error('Daemon startup timed out'));
    }, 10000);

    child.on('message', (msg) => {
      if (msg === 'ready') {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.unref();
        child.disconnect();
        resolve();
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.unref();
      try { child.disconnect(); } catch {}
      reject(new Error(`Failed to start daemon: ${err.message}`));
    });
  });
}

export async function sendCommand(cmd: Command): Promise<Response> {
  await ensureDaemon();

  const socketPath = getSocketPath();

  return new Promise<Response>((resolve, reject) => {
    const client = net.createConnection(socketPath);
    let buffer = '';
    const commandTimeout = cmd.timeout || 30000;

    const timer = setTimeout(() => {
      client.destroy();
      resolve({
        success: false,
        error: 'timeout',
        message: `Command timed out after ${commandTimeout}ms`
      });
    }, commandTimeout + 5000); // Extra 5s for IPC overhead

    client.on('connect', () => {
      client.write(serializeCommand(cmd));
    });

    client.on('data', (data) => {
      buffer += data.toString();
      if (buffer.includes('\n')) {
        clearTimeout(timer);
        const line = buffer.split('\n')[0];
        client.end();
        try {
          resolve(deserializeResponse(line));
        } catch (err: any) {
          resolve({
            success: false,
            error: 'daemon_error',
            message: `Invalid response: ${err.message}`
          });
        }
      }
    });

    client.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        error: 'daemon_error',
        message: `Connection to daemon failed: ${err.message}`
      });
    });
  });
}

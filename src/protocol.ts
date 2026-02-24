import type { Command, Response, ErrorCode } from './types.js';

export function serializeCommand(cmd: Command): string {
  return JSON.stringify(cmd) + '\n';
}

export function deserializeCommand(data: string): Command {
  return JSON.parse(data.trim()) as Command;
}

export function serializeResponse(res: Response): string {
  return JSON.stringify(res) + '\n';
}

export function deserializeResponse(data: string): Response {
  return JSON.parse(data.trim()) as Response;
}

export function successResponse<T extends Record<string, unknown>>(data: T): Response<T> {
  return { success: true, data };
}

export function errorResponse(error: ErrorCode, message: string): Response {
  return { success: false, error, message };
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

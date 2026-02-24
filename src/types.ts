// ============================================================
// agent-electron types
// ============================================================

// --- Error codes ---
export type ErrorCode =
  | 'app_not_running'
  | 'launch_failed'
  | 'connection_failed'
  | 'element_not_found'
  | 'element_not_visible'
  | 'invalid_scope_selector'
  | 'scope_not_accessible'
  | 'timeout'
  | 'eval_error'
  | 'invalid_command'
  | 'daemon_error';

// --- Response ---
export interface SuccessResponse<T = Record<string, unknown>> {
  success: true;
  data: T;
}

export interface ErrorResponse {
  success: false;
  error: ErrorCode;
  message: string;
}

export type Response<T = Record<string, unknown>> = SuccessResponse<T> | ErrorResponse;

// --- Commands ---
export interface BaseCommand {
  id: string;
  action: string;
  timeout?: number;
}

export interface LaunchCommand extends BaseCommand {
  action: 'launch';
  path: string;
  args?: string[];
  executablePath?: string;
}

export interface ConnectCommand extends BaseCommand {
  action: 'connect';
  port: number;
}

export interface CloseCommand extends BaseCommand {
  action: 'close';
}

export interface SnapshotCommand extends BaseCommand {
  action: 'snapshot';
  interactive?: boolean;
  compact?: boolean;
  depth?: number;
  selector?: string;
}

export interface ClickCommand extends BaseCommand {
  action: 'click';
  target?: string; // @ref or selector
  text?: string;   // visible label text (case-insensitive, whitespace-normalized, exact match)
  retries?: number;    // retry attempts for --text (default 10)
  retryDelay?: number; // ms between retries for --text (default 150)
  scopeSelector?: string; // CSS selector to scope text search (resolves iframe/frame contentDocument or container)
}

export interface FillCommand extends BaseCommand {
  action: 'fill';
  target: string;
  value: string;
}

export interface TypeCommand extends BaseCommand {
  action: 'type';
  target: string;
  text: string;
}

export interface PressCommand extends BaseCommand {
  action: 'press';
  key: string;
}

export interface SelectCommand extends BaseCommand {
  action: 'select';
  target: string;
  value: string;
}

export interface CheckCommand extends BaseCommand {
  action: 'check';
  target: string;
}

export interface HoverCommand extends BaseCommand {
  action: 'hover';
  target: string;
}

export interface ScrollCommand extends BaseCommand {
  action: 'scroll';
  direction: 'up' | 'down' | 'left' | 'right';
  amount?: number;
}

export interface EvalCommand extends BaseCommand {
  action: 'eval';
  script: string;
}

export interface EvalMainCommand extends BaseCommand {
  action: 'eval-main';
  script: string;
}

export interface ScreenshotCommand extends BaseCommand {
  action: 'screenshot';
  path?: string;
  fullPage?: boolean;
}

export interface GetTextCommand extends BaseCommand {
  action: 'get-text';
  target: string;
}

export interface GetValueCommand extends BaseCommand {
  action: 'get-value';
  target: string;
}

export interface GetTitleCommand extends BaseCommand {
  action: 'get-title';
}

export interface GetUrlCommand extends BaseCommand {
  action: 'get-url';
}

export interface IsVisibleCommand extends BaseCommand {
  action: 'is-visible';
  target: string;
}

export interface WaitCommand extends BaseCommand {
  action: 'wait';
  target?: string;    // @ref or selector — wait for visible
  ms?: number;        // wait fixed time
  text?: string;      // wait for text
  gone?: string;      // wait for element to disappear
  fn?: string;        // wait for JS condition
}

export interface WindowListCommand extends BaseCommand {
  action: 'window-list';
}

export interface WindowSwitchCommand extends BaseCommand {
  action: 'window-switch';
  index: number;
}

export interface FrameListCommand extends BaseCommand {
  action: 'frame-list';
}

export interface FrameSwitchCommand extends BaseCommand {
  action: 'frame-switch';
  index: number;
}

export interface FrameResetCommand extends BaseCommand {
  action: 'frame-reset';
}

export interface TargetListCommand extends BaseCommand {
  action: 'target-list';
}

export interface TargetSwitchCommand extends BaseCommand {
  action: 'target-switch';
  index?: number;
  match?: string;
  all?: boolean;
}

export interface EditorSetCommand extends BaseCommand {
  action: 'editor-set';
  target: string; // CSS selector for the editor element
  text: string;   // text to set
  scopeSelector?: string; // CSS selector to scope editor lookup (resolves iframe/frame contentDocument or container)
}

export interface EditorGetCommand extends BaseCommand {
  action: 'editor-get';
  target: string; // CSS selector for the editor element
  scopeSelector?: string; // CSS selector to scope editor lookup (resolves iframe/frame contentDocument or container)
}

export type Command =
  | LaunchCommand
  | ConnectCommand
  | CloseCommand
  | SnapshotCommand
  | ClickCommand
  | FillCommand
  | TypeCommand
  | PressCommand
  | SelectCommand
  | CheckCommand
  | HoverCommand
  | ScrollCommand
  | EvalCommand
  | EvalMainCommand
  | ScreenshotCommand
  | GetTextCommand
  | GetValueCommand
  | GetTitleCommand
  | GetUrlCommand
  | IsVisibleCommand
  | WaitCommand
  | WindowListCommand
  | WindowSwitchCommand
  | FrameListCommand
  | FrameSwitchCommand
  | FrameResetCommand
  | TargetListCommand
  | TargetSwitchCommand
  | EditorSetCommand
  | EditorGetCommand;

// --- Ref Map ---
export interface RefInfo {
  role: string;
  name?: string;
  selector: string;
  nth?: number;
}

export type RefMap = Record<string, RefInfo>;

// --- Default timeouts ---
export const DEFAULT_TIMEOUTS: Record<string, number> = {
  launch: 30000,
  connect: 10000,
  close: 5000,
  snapshot: 10000,
  click: 5000,
  fill: 5000,
  type: 5000,
  press: 5000,
  select: 5000,
  check: 5000,
  hover: 5000,
  scroll: 5000,
  eval: 10000,
  'eval-main': 10000,
  screenshot: 10000,
  'get-text': 5000,
  'get-value': 5000,
  'get-title': 5000,
  'get-url': 5000,
  'is-visible': 5000,
  wait: 30000,
  'window-list': 5000,
  'window-switch': 5000,
  'frame-list': 5000,
  'frame-switch': 5000,
  'frame-reset': 5000,
  'target-list': 5000,
  'target-switch': 10000,
  'editor-set': 10000,
  'editor-get': 5000,
};

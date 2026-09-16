/**
 * Contracts for the exit-time persistence hook.
 */

/**
 * Document surface of the secondary trigger.
 *
 * visibilityState - Drives the hidden check; absent in non-DOM hosts.
 * addEventListener - `visibilitychange` registration target.
 * removeEventListener - Counterpart used by detach.
 */
interface ExitFlushDocumentLike {
  visibilityState?: string;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/**
 * Browser surface the hook listens on. `document` is optional so a
 * non-DOM host degrades to a no-op attach.
 *
 * document - Secondary-trigger target; see ExitFlushDocumentLike.
 * addEventListener - `pagehide` registration target.
 * removeEventListener - Counterpart used by detach.
 */
interface ExitFlushWindowLike {
  document?: ExitFlushDocumentLike;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/**
 * Arguments of `attachExitFlush`.
 *
 * flush - Persist callback; the hook fires it without awaiting and
 *   contains its rejections (nothing can await inside a closing page).
 * win - Injection seam for tests; defaults to `globalThis`.
 */
interface AttachExitFlushArgs {
  flush: () => Promise<void>;
  win?: ExitFlushWindowLike;
}

export type { AttachExitFlushArgs, ExitFlushDocumentLike, ExitFlushWindowLike };

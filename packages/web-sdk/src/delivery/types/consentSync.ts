/**
 * Contracts for cross-tab consent propagation.
 */

import type { WebSdkRuntime } from '../../types/runtime';

/**
 * Document surface the re-read trigger listens on.
 *
 * addEventListener - `visibilitychange` registration target.
 * removeEventListener - Counterpart used by detach.
 */
interface ConsentSyncDocumentLike {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/**
 * Browser surface this listener needs, so tests can drive it without a
 * DOM. `document` is optional: a non-DOM host keeps the `storage`
 * trigger and loses only the re-read.
 *
 * document - Visibility-trigger target.
 * addEventListener - `storage` registration target.
 * removeEventListener - Counterpart used by detach.
 */
interface ConsentSyncWindowLike {
  document?: ConsentSyncDocumentLike;
  addEventListener(type: string, listener: (event: { key?: string | null }) => void): void;
  removeEventListener(type: string, listener: (event: { key?: string | null }) => void): void;
}

/**
 * Arguments of `attachConsentSync`.
 *
 * runtime - Session whose cached consent the listener refreshes.
 * win - Injection seam for tests; defaults to `globalThis`.
 */
interface AttachConsentSyncArgs {
  runtime: WebSdkRuntime;
  win?: ConsentSyncWindowLike;
}

export type { AttachConsentSyncArgs, ConsentSyncDocumentLike, ConsentSyncWindowLike };

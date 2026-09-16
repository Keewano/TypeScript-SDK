/**
 * React Native UI tracking: scene load/unload, plus the shared
 * button-click / window open-close trio re-exported from
 * `@keewano/core`. The scene methods maintain the navigation cursor
 * (`runtime.lastSceneName`), which is React-Native-specific, so they
 * stay in this package.
 */

import type { SdkRuntime } from '../runtime';

import { KEvents, runWhenReady, truncateString } from '@keewano/core';

/**
 * Emit a `SCENE_LOADED` event with the (truncated) scene / route
 * name; distinct from {@link reportWindowOpen}, which is for
 * in-screen modals / popups. Blank / whitespace-only names
 * short-circuit: an empty string would emit a zero-length wire event
 * AND pin `runtime.lastSceneName=''`, which the next transition would
 * treat as a real scene and emit a bogus `SCENE_UNLOADED('')` for.
 */
function reportSceneLoaded(name: string): void {
  /**
   * Untyped JS hosts can feed non-strings despite the TS signature;
   * `.trim()` would throw into the host. Degrade to a no-op.
   */
  if (typeof name !== 'string') return;
  const normalized = name.trim();
  if (normalized.length === 0) return;
  runWhenReady<SdkRuntime>((runtime) => {
    runtime.dispatcher.addEventString({
      eventId: KEvents.SCENE_LOADED,
      str: truncateString(normalized),
    });
    /**
     * Write the cursor at emission time so a queued call (the hook
     * fires during init, before the runtime exists) lands the cursor
     * together with the event; the hook's own `writeSceneCursor` is a
     * no-op while `runtime` is null, and a missing cursor would make
     * the next transition skip its SCENE_UNLOADED.
     */
    runtime.lastSceneName = normalized;
  });
}

/**
 * Emit a `SCENE_UNLOADED` event with the (truncated) scene / route
 * name. Blank / whitespace-only names short-circuit (same rationale
 * as `reportSceneLoaded`).
 */
function reportSceneUnloaded(name: string): void {
  /** Same fail-soft guard as `reportSceneLoaded`. */
  if (typeof name !== 'string') return;
  const normalized = name.trim();
  if (normalized.length === 0) return;
  runWhenReady<SdkRuntime>((runtime) => {
    runtime.dispatcher.addEventString({
      eventId: KEvents.SCENE_UNLOADED,
      str: truncateString(normalized),
    });
    /**
     * Clear the cursor when the standalone unload matches the tracked
     * scene; otherwise a direct call outside `useKeewanoNavigation`
     * leaves it stale and the next navigation change emits a
     * duplicate SCENE_UNLOADED. `lastSceneName` is always the trimmed
     * (untruncated) name, so a normalized-name match suffices.
     */
    if (runtime.lastSceneName === normalized) {
      runtime.lastSceneName = undefined;
    }
  });
}

export { reportButtonClick, reportWindowClose, reportWindowOpen } from '@keewano/core';
export { reportSceneLoaded, reportSceneUnloaded };

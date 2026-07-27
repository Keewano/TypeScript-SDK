/**
 * React Native UI tracking methods: button clicks, window open/close,
 * and scene load/unload. Each emits one event record onto the
 * dispatcher. The scene methods also maintain the navigation cursor
 * (`runtime.lastSceneName`), which is React-Native-specific, so this
 * module stays in the platform package while the cross-platform
 * progression signals (onboarding, A/B test) live in `@keewano/core`.
 */

import type { SdkRuntime } from '../runtime';

import { KEvents, runWhenReady, truncateString } from '@keewano/core';

/**
 * Emit a `BUTTON_CLICK` event with the (truncated) button name as
 * payload. Truncation keeps the wire payload bounded at 256 chars.
 */
function reportButtonClick(name: string): void {
  runWhenReady((runtime) => {
    runtime.dispatcher.addEventString({
      eventId: KEvents.BUTTON_CLICK,
      str: truncateString(name),
    });
  });
}

/** Emit a `WINDOW_OPEN` event with the (truncated) window name. */
function reportWindowOpen(name: string): void {
  runWhenReady((runtime) => {
    runtime.dispatcher.addEventString({
      eventId: KEvents.WINDOW_OPEN,
      str: truncateString(name),
    });
  });
}

/** Emit a `WINDOW_CLOSE` event with the (truncated) window name. */
function reportWindowClose(name: string): void {
  runWhenReady((runtime) => {
    runtime.dispatcher.addEventString({
      eventId: KEvents.WINDOW_CLOSE,
      str: truncateString(name),
    });
  });
}

/**
 * Emit a `SCENE_LOADED` event with the (truncated) scene / route name.
 * Used by the navigation hooks (`useKeewanoNavigation`) to report
 * full-screen route transitions; distinct from
 * {@link reportWindowOpen}, which is for in-screen modals / popups.
 *
 * Blank / whitespace-only names short-circuit. A direct host call with
 * an empty string would otherwise emit a zero-length wire event AND
 * pin `runtime.lastSceneName=''`, which the next transition's
 * `previous` check (`previous !== undefined`) would treat as a real
 * scene and emit a bogus `SCENE_UNLOADED('')` for it.
 */
function reportSceneLoaded(name: string): void {
  /**
   * `name.trim()` throws `TypeError` on `null` / `undefined` / objects.
   * The TS signature pins the input to `string`, but untyped JS hosts
   * (and tests / tooling that bypass TS) can still feed bad values.
   * Degrade to a no-op instead of crashing the host app.
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
     * Persist the scene cursor at emission time so a queued call (the
     * hook fires during init, before the runtime exists) lands the
     * cursor write together with the SCENE_LOADED event. The hook's
     * own `writeSceneCursor` is a no-op while `runtime` is null, so
     * without this line the cursor would stay `undefined` and the
     * next transition would skip its SCENE_UNLOADED.
     */
    runtime.lastSceneName = normalized;
  });
}

/**
 * Emit a `SCENE_UNLOADED` event with the (truncated) scene / route name.
 *
 * Blank / whitespace-only names short-circuit (same rationale as
 * `reportSceneLoaded`: a blank name would otherwise emit a noise
 * wire event and, if the cursor happened to be blank too, would
 * wrongly clear it).
 */
function reportSceneUnloaded(name: string): void {
  /**
   * Same fail-soft guard as `reportSceneLoaded` - untyped JS callers
   * can hand us `null` / `undefined` / an object and `.trim()` would
   * otherwise throw out into the host's call site.
   */
  if (typeof name !== 'string') return;
  const normalized = name.trim();
  if (normalized.length === 0) return;
  runWhenReady<SdkRuntime>((runtime) => {
    runtime.dispatcher.addEventString({
      eventId: KEvents.SCENE_UNLOADED,
      str: truncateString(normalized),
    });
    /**
     * Clear the scene cursor when the standalone unload matches the
     * currently tracked scene. Without this, a direct
     * `reportSceneUnloaded(name)` call (outside `useKeewanoNavigation`)
     * leaves `runtime.lastSceneName` stale, so the next navigation
     * change would emit a duplicate SCENE_UNLOADED for a scene that
     * was already closed. `lastSceneName` is always written as the
     * trimmed (untruncated) name, so a normalized-name match is
     * sufficient.
     */
    if (runtime.lastSceneName === normalized) {
      runtime.lastSceneName = undefined;
    }
  });
}

export {
  reportButtonClick,
  reportSceneLoaded,
  reportSceneUnloaded,
  reportWindowClose,
  reportWindowOpen,
};

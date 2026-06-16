/**
 * Internal helpers for reading + writing the active session's last
 * emitted scene name. The cursor lives on `runtime.lastSceneName`
 * so:
 *
 *   - `Keewano.shutdown()` resets it (the runtime is cleared on
 *     shutdown AND `resetSceneCursor()` is called to drop the
 *     module-scope pre-init buffer), eliminating the cross-session
 *     phantom-SCENE_UNLOADED bug a leaked buffer would otherwise
 *     produce on the first nav transition after re-init.
 *   - React Strict Mode and Fast Refresh remounts of the host
 *     component do NOT reset it (the runtime survives across the
 *     React-lifecycle boundary), eliminating the duplicate-SCENE_LOADED
 *     bug a `useRef`-scoped cursor would have.
 *   - Pre-init / post-shutdown reads return `undefined` and writes
 *     silently no-op (no runtime to mutate).
 *
 * `readSceneCursor` / `writeSceneCursor` are re-exported from the
 * package barrel on purpose: the sibling `@keewano/react-native-expo-sdk`
 * navigation hook imports them to share this single runtime cursor, so
 * a host using either package gets coherent SCENE_LOADED / SCENE_UNLOADED
 * sequencing. They are part of the cross-package contract rather than a
 * surface end users are expected to drive themselves - the navigation
 * hooks own the read/write discipline. `resetSceneCursor` stays out of
 * the barrel: it is a teardown-only concern owned by `Keewano.shutdown()`.
 */

import { getRuntimeOrNull } from '../runtime';

/**
 * Module-scope buffer for cursor writes that happen while the runtime
 * does not exist yet (rapid pre-init navigation). The first read after
 * the runtime is installed hydrates `runtime.lastSceneName` from the
 * buffer and clears it, so a second pre-init transition can correctly
 * read 'A' as `previous` and emit SCENE_UNLOADED('A') instead of
 * silently double-emitting SCENE_LOADED.
 */
let pendingSceneName: string | undefined;

/**
 * Read the last scene name the navigation hooks emitted SCENE_LOADED
 * for. Returns `undefined` when no scene has been emitted yet OR
 * when the SDK is not initialised AND no pre-init write is pending.
 *
 * When the runtime exists and the runtime's cursor is still
 * `undefined` but a `pendingSceneName` buffered, hydrate the cursor
 * from the buffer and clear it. This makes the queued pre-init writes
 * land coherently with the queued `reportSceneLoaded` calls that
 * `runWhenReady` drains right after `setRuntime`.
 */
function readSceneCursor(): string | undefined {
  const runtime = getRuntimeOrNull();
  if (runtime === null) return pendingSceneName;
  if (runtime.lastSceneName === undefined && pendingSceneName !== undefined) {
    runtime.lastSceneName = pendingSceneName;
  }
  pendingSceneName = undefined;
  return runtime.lastSceneName;
}

/**
 * Write the cursor. When the SDK runtime does not exist yet (pre-init
 * navigation), park the value in a module-scope buffer so subsequent
 * pre-init reads observe it and a rapid second transition can still
 * emit the right SCENE_UNLOADED. The buffer is drained on the first
 * post-init read.
 */
function writeSceneCursor(name: string | undefined): void {
  const runtime = getRuntimeOrNull();
  if (runtime === null) {
    pendingSceneName = name;
    return;
  }
  pendingSceneName = undefined;
  runtime.lastSceneName = name;
}

/**
 * Drop both the module-scope pre-init buffer AND any active runtime
 * cursor. Called from `Keewano.shutdown()` so a stale pre-init or
 * post-shutdown `writeSceneCursor` cannot survive across the
 * shutdown / re-init boundary and produce a phantom SCENE_UNLOADED
 * on the first nav transition of the next session.
 *
 * Safe to call at any time: idempotent, and the runtime-cursor write
 * is gated on the runtime existing.
 */
function resetSceneCursor(): void {
  pendingSceneName = undefined;
  const runtime = getRuntimeOrNull();
  if (runtime !== null) runtime.lastSceneName = undefined;
}

export { readSceneCursor, resetSceneCursor, writeSceneCursor };

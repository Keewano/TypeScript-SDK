/**
 * `useKeewanoNavigation` hook for `@react-navigation/native`. Wires
 * the host's `NavigationContainer` ref into the SDK so screen
 * transitions emit SCENE_LOADED / SCENE_UNLOADED events.
 *
 * SCENE_* (not WINDOW_*) is the wire-protocol distinction: scenes
 * are full-screen route transitions, windows are in-screen modals /
 * popups the host explicitly reports via `Keewano.reportWindowOpen`.
 *
 * Usage:
 * ```tsx
 *   const navigationRef = useNavigationContainerRef();
 *   useKeewanoNavigation(navigationRef);
 *   return <NavigationContainer ref={navigationRef}>...</NavigationContainer>;
 * ```
 *
 * Behaviour:
 *   - On the first observed route, emits SCENE_LOADED(name).
 *   - On every subsequent transition where the route name changes,
 *     emits SCENE_UNLOADED(previous) THEN SCENE_LOADED(current).
 *   - Unchanged-name transitions (route params change but the screen
 *     does not) are a no-op.
 *   - When the ref becomes `null` (NavigationContainer unmounted),
 *     the subscription is removed without emitting SCENE_UNLOADED -
 *     unmount is not a user-visible screen close.
 *   - The cursor lives on the SDK runtime, not in module scope or a
 *     `useRef`. Strict Mode / Fast Refresh remounts of the host
 *     component do NOT emit a duplicate SCENE_LOADED for the same
 *     screen, and `Keewano.shutdown()` resets the cursor so a
 *     subsequent `Keewano.init()` starts clean.
 *
 * The hook accepts a structural `NavigationContainerRefLike` shape
 * so `@react-navigation/native` is not a hard dependency; any object
 * with the matching `.current` API works.
 */

import type {
  NavigationContainerLike,
  NavigationContainerRefLike,
} from './types/useKeewanoNavigation';

import { useEffect } from 'react';

import { Keewano } from '../keewano';

import { readSceneCursor, writeSceneCursor } from './sceneCursor';

/**
 * Subscribe to navigation state changes on `ref.current`. The effect
 * is keyed on the container instance itself, not the ref wrapper, so
 * a late `ref.current` assignment (initial null mount that fills in
 * after first render) or a container swap (key-based remount, lazy
 * NavigationContainer mount) re-runs the subscription cleanly.
 */
function useKeewanoNavigation(ref: NavigationContainerRefLike): void {
  /**
   * No dependency array: refs are updated DURING the commit phase, so
   * a render-time snapshot of `ref.current` can still point at the
   * previous container during a key-based remount even after React
   * already swapped it in. Running this effect after every render and
   * reading `ref.current` only inside the effect tracks the committed
   * container exactly. The cleanup + resubscribe cost per render is
   * bounded by addListener (O(1) on react-navigation containers), and
   * `tryEmitTransition` coalesces same-route emits.
   */
  useEffect(() => {
    const container = ref.current;
    if (container == null) return undefined;

    const handleStateChange = (): void => {
      tryEmitTransition(container);
    };

    /** Emit the initial route synchronously so the first screen is tracked. */
    handleStateChange();

    /**
     * `container.addListener` is structurally typed to return an
     * unsubscribe function, which is the `@react-navigation/native`
     * contract. Some compatible navigation containers (legacy / custom
     * adapters) return a subscription object with a `.remove()` method
     * instead. Cover both shapes so subscriptions are not leaked
     * across remounts or container swaps.
     */
    let subscription: (() => void) | { remove?: () => void } | undefined;
    try {
      subscription = container.addListener('state', handleStateChange);
    } catch {
      /** Best-effort: a broken ref shouldn't crash the host. */
    }

    return () => {
      try {
        if (typeof subscription === 'function') {
          subscription();
        } else if (typeof subscription?.remove === 'function') {
          subscription.remove();
        }
      } catch {
        /** Best-effort hook cleanup. */
      }
    };
  });
}

/**
 * Read the current route name off the container and emit
 * SCENE_UNLOADED / SCENE_LOADED as needed. The cursor on
 * `runtime.lastSceneName` is only advanced when an emit succeeds:
 * a swallowed pre-init / shutdown throw leaves the cursor pinned
 * so the wire stream never carries an unbalanced SCENE_UNLOADED
 * for a SCENE_LOADED that never landed.
 */
function tryEmitTransition(container: NavigationContainerLike): void {
  const routeName = readRouteName(container);
  /**
   * Normalize once and use the trimmed value for the cursor compare,
   * the wire emit, AND the cursor write. `Keewano.reportSceneLoaded`
   * internally trims and pins `runtime.lastSceneName` to the trimmed
   * name; if the hook then writeSceneCursor'd the RAW routeName it
   * would overwrite the cursor back to the whitespace-padded value,
   * desyncing the next transition's cursor compare and producing
   * duplicate SCENE_UNLOADED / SCENE_LOADED pairs for the same route.
   *
   * React Navigation can also briefly report `undefined` during
   * resets, key-based remounts, or partial navigator initialization.
   * Treating that transient gap as a real SCENE_UNLOADED would leave
   * the wire stream unbalanced and double-emit SCENE_LOADED once the
   * same route returns. Skip until we observe a real route name.
   */
  const next = typeof routeName === 'string' ? routeName.trim() : '';
  if (next.length === 0) return;
  const previous = readSceneCursor();
  if (next === previous) return;
  if (previous !== undefined) {
    try {
      Keewano.reportSceneUnloaded(previous);
    } catch {
      /**
       * SCENE_UNLOADED failed (pre-init / shutdown window). Bail out
       * without advancing the cursor or emitting the new SCENE_LOADED
       * so the wire stream stays balanced: the next successful emit
       * will re-attempt the unload against the same `previous` cursor.
       */
      return;
    }
  }
  try {
    Keewano.reportSceneLoaded(next);
    writeSceneCursor(next);
  } catch {
    /**
     * SCENE_LOADED failed AFTER the unload succeeded. Acknowledge the
     * unload by clearing the cursor so the next transition does not
     * try to re-unload an already-unloaded scene.
     */
    if (previous !== undefined) writeSceneCursor(undefined);
  }
}

/**
 * Pull the current route name off the navigation container, falling
 * back to `undefined` on any read error (broken ref / partial mock /
 * route descriptor without a name).
 */
function readRouteName(container: NavigationContainerLike): string | undefined {
  try {
    const route = container.getCurrentRoute();
    if (typeof route?.name !== 'string' || route.name.length === 0) return undefined;
    return route.name;
  } catch {
    return undefined;
  }
}

export type {
  NavigationContainerLike,
  NavigationContainerRefLike,
  NavigationRouteLike,
} from './types/useKeewanoNavigation';
export { useKeewanoNavigation };

/**
 * `useKeewanoNavigation` hook for `@react-navigation/native`: screen
 * transitions emit SCENE_LOADED / SCENE_UNLOADED. SCENE_* (not WINDOW_*)
 * is the wire distinction - scenes are full-screen route transitions;
 * windows are in-screen modals the host reports via `reportWindowOpen`.
 *
 * ```tsx
 *   const navigationRef = useNavigationContainerRef();
 *   useKeewanoNavigation(navigationRef);
 *   return <NavigationContainer ref={navigationRef}>...</NavigationContainer>;
 * ```
 *
 * The transition cursor lives on the SDK runtime (not module scope /
 * useRef), so a Strict Mode / Fast Refresh remount does not re-emit
 * SCENE_LOADED for the same screen, and `shutdown()` resets it. The
 * ref is accepted structurally so react-navigation is not a hard dep.
 */

import type {
  NavigationContainerLike,
  NavigationContainerRefLike,
} from './types/useKeewanoNavigation';

import { useEffect } from 'react';

import { Keewano } from '../keewano';

import { readSceneCursor, writeSceneCursor } from './sceneCursor';

function useKeewanoNavigation(ref: NavigationContainerRefLike): void {
  // No dependency array: refs update during commit, so a render-time snapshot of ref.current can
  // still point at the previous container during a key-based remount. Reading ref.current only
  // inside the effect (which runs every render) tracks the committed container exactly; the
  // resubscribe cost is O(1) and tryEmitTransition coalesces same-route emits.
  useEffect(() => {
    const container = ref.current;
    if (container == null) return undefined;

    const handleStateChange = (): void => {
      tryEmitTransition(container);
    };

    // Emit the initial route synchronously.
    handleStateChange();

    // Cover both addListener shapes (unsubscribe fn per react-navigation, or a .remove()
    // subscription from custom adapters) so subscriptions are not leaked across remounts.
    let subscription: (() => void) | { remove?: () => void } | undefined;
    try {
      subscription = container.addListener('state', handleStateChange);
    } catch {
      // Best-effort: a broken ref must not crash the host.
    }

    return () => {
      try {
        if (typeof subscription === 'function') {
          subscription();
        } else if (typeof subscription?.remove === 'function') {
          subscription.remove();
        }
      } catch {
        // Best-effort.
      }
    };
  });
}

/**
 * Emit SCENE_UNLOADED / SCENE_LOADED for a route change. The cursor is
 * advanced only on a successful emit, so a swallowed pre-init/shutdown
 * throw leaves the wire stream balanced (no orphan SCENE_UNLOADED).
 */
function tryEmitTransition(container: NavigationContainerLike): void {
  const routeName = readRouteName(container);
  // Trim once and use the trimmed value everywhere: reportSceneLoaded pins the cursor to the
  // trimmed name, so writing the RAW name back would desync the next compare and double-emit.
  // A transient undefined (resets, partial init) is skipped, not treated as a real unload.
  const next = typeof routeName === 'string' ? routeName.trim() : '';
  if (next.length === 0) return;
  const previous = readSceneCursor();
  if (next === previous) return;
  if (previous !== undefined) {
    try {
      Keewano.reportSceneUnloaded(previous);
    } catch {
      // Unload failed (pre-init/shutdown): bail without advancing so the next emit retries it.
      return;
    }
  }
  try {
    Keewano.reportSceneLoaded(next);
    writeSceneCursor(next);
  } catch {
    // Load failed after the unload succeeded: clear the cursor so we do not re-unload it.
    if (previous !== undefined) writeSceneCursor(undefined);
  }
}

/** Current route name, or `undefined` on any read error (broken ref, unnamed route). */
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

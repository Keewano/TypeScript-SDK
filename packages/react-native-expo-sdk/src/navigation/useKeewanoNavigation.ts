/**
 * `useKeewanoNavigation` hook for Expo Router. Wires the host's
 * `usePathname` hook into the SDK so screen transitions emit
 * SCENE_LOADED / SCENE_UNLOADED events.
 *
 * SCENE_* (not WINDOW_*) is the wire-protocol distinction: scenes
 * are full-screen route transitions, windows are in-screen modals /
 * popups the host explicitly reports via `Keewano.reportWindowOpen`.
 *
 * Usage:
 * ```tsx
 *   import { usePathname } from 'expo-router';
 *   import { useKeewanoNavigation } from '@keewano/react-native-expo-sdk';
 *
 *   function RootLayout() {
 *     useKeewanoNavigation(usePathname);
 *     return <Slot />;
 *   }
 * ```
 *
 * The host's `usePathname` is passed as a function so the SDK has
 * no static dependency on `expo-router`. Apps that do not use Expo
 * Router pay no bundle cost.
 *
 * Behaviour:
 *   - On the first non-empty pathname, emits SCENE_LOADED(pathname).
 *   - On every subsequent change, emits SCENE_UNLOADED(prev) THEN
 *     SCENE_LOADED(next).
 *   - Empty / blank pathnames are skipped so a transient unmount does
 *     not emit a noisy `SCENE_LOADED('')`.
 *   - The cursor lives on the SDK runtime (shared with the
 *     react-navigation hook), not in module scope or a `useRef`.
 *     Strict Mode / Fast Refresh remounts do NOT emit a duplicate
 *     SCENE_LOADED for the same pathname, and `Keewano.shutdown()`
 *     resets the cursor so a subsequent `Keewano.init()` starts
 *     clean.
 */

import type { UsePathnameHook } from './types/useKeewanoNavigation';

import { useEffect } from 'react';

import { Keewano, readSceneCursor, writeSceneCursor } from '@keewano/react-native-sdk';

/**
 * Track Expo Router pathname changes and emit the matching
 * SCENE_LOADED / SCENE_UNLOADED events.
 *
 * @param usePathname - The `usePathname` export from `expo-router`,
 *   passed by the host. Returns the current path string. Re-runs on
 *   every navigation transition.
 */
function useKeewanoNavigation(usePathname: UsePathnameHook): void {
  const pathname = usePathname();

  useEffect(() => {
    /**
     * Normalize once and use the trimmed value for the cursor compare,
     * the wire emit, AND the cursor write. `Keewano.reportSceneLoaded`
     * internally trims and pins `runtime.lastSceneName` to the trimmed
     * name; if the hook then writeSceneCursor'd the RAW pathname it
     * would overwrite the cursor back to the whitespace-padded value,
     * desyncing the next render's compare and producing duplicate
     * SCENE_UNLOADED / SCENE_LOADED pairs for the same route.
     *
     * Blank / whitespace-only pathnames are observed during transient
     * remounts and router resets - emitting SCENE_UNLOADED then would
     * produce false unload pairs the host never intended. The hook
     * leaves the cursor untouched until a real non-blank pathname
     * appears.
     */
    const normalized = typeof pathname === 'string' ? pathname.trim() : '';
    const next = normalized.length > 0 ? normalized : undefined;
    if (next === undefined) return;
    const previous = readSceneCursor();
    if (next === previous) return;
    if (previous !== undefined) {
      try {
        Keewano.reportSceneUnloaded(previous);
      } catch {
        /**
         * SCENE_UNLOADED failed (pre-init / shutdown). Bail out
         * without advancing the cursor or emitting the new
         * SCENE_LOADED so the wire stream stays balanced.
         */
        return;
      }
    }
    try {
      Keewano.reportSceneLoaded(next);
      writeSceneCursor(next);
    } catch {
      /** Load failed after a successful unload - acknowledge the unload by clearing the cursor. */
      if (previous !== undefined) writeSceneCursor(undefined);
    }
    /**
     * `[pathname]` is the correct dependency here because expo-router's
     * `usePathname` yields a stable string per route, so the effect
     * fires exactly once per transition. This differs from the
     * react-navigation sibling hook, which intentionally omits the
     * dependency array and re-runs every render because navigation refs
     * are reassigned during commit and never change identity stably.
     */
  }, [pathname]);
}

export type { UsePathnameHook } from './types/useKeewanoNavigation';
export { useKeewanoNavigation };

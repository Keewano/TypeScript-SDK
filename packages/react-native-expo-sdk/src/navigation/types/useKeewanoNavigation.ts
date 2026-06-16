/**
 * Hook signature matching `usePathname` from `expo-router`. Passed
 * as an argument to `useKeewanoNavigation` so the SDK does not have
 * to take a hard dependency on `expo-router`. Hosts that do not use
 * Expo Router pay no bundle cost.
 *
 * The pathname is the URL-style route string Expo Router exposes
 * (e.g. `'/'`, `'/profile'`, `'/posts/[id]'`). The SDK emits it
 * verbatim as the SCENE_LOADED payload.
 */
type UsePathnameHook = () => string;

export type { UsePathnameHook };

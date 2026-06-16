/**
 * Structural shape of a `@react-navigation/native`
 * `NavigationContainerRef`. Defined locally so:
 *
 *   1. `@keewano/react-native-sdk` has no static dependency on
 *      `@react-navigation/native` - hosts that do not use it pay no
 *      bundle cost.
 *   2. Unit tests can drive the hook with a hand-built object.
 *
 * getCurrentRoute - Returns the active route descriptor or
 *   `undefined` when no navigation has happened yet. The tracker
 *   reads `.name` off the returned route.
 * addListener - Subscribes to `'state'` events. Fires after every
 *   navigation transition. Returns an unsubscribe function.
 */
interface NavigationRouteLike {
  name?: string;
}

/**
 * Subscription object returned by some structurally-compatible
 * `addListener` implementations (legacy / custom navigation refs)
 * instead of a bare unsubscribe function. The hook cleanup handles
 * both shapes; this type lets typed consumers hand us either without
 * an unsafe cast.
 */
interface NavigationSubscriptionLike {
  remove?: () => void;
}

interface NavigationContainerLike {
  getCurrentRoute: () => NavigationRouteLike | undefined;
  addListener: (event: 'state', callback: () => void) => (() => void) | NavigationSubscriptionLike;
}

/**
 * Ref-like wrapper around `NavigationContainerLike`. Matches both
 * React's `RefObject<T>` (mutable `.current`) and the
 * `useNavigationContainerRef()` return shape from
 * `@react-navigation/native`.
 */
interface NavigationContainerRefLike {
  current: NavigationContainerLike | null;
}

export type {
  NavigationContainerLike,
  NavigationContainerRefLike,
  NavigationRouteLike,
  NavigationSubscriptionLike,
};

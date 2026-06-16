/**
 * Structural shape of the subset of React Native's top-level module
 * the built-in trackers depend on. Defined locally (instead of
 * importing from `react-native`) so:
 *
 *   1. `@keewano/react-native-sdk` consumers do not need to install
 *      `react-native` types just to compile the SDK.
 *   2. Unit tests can inject a hand-built mock without resolving the
 *      real `react-native` package under a `node` Jest environment.
 *   3. Each tracker depends only on the fields it actually reads, so
 *      a partial mock satisfies the contract.
 *
 * Every field is optional. A tracker that observes a missing field
 * MUST fall back to a no-op detach instead of throwing - the SDK
 * boot must survive partial / broken RN shims.
 *
 * Platform.OS - String identifier ('ios' / 'android' / 'web' / ...).
 *   Used by trackers that gate on platform (e.g. BackHandler is
 *   Android-only).
 * AppState.addEventListener - RN AppState change subscription factory.
 *   Returns either a subscription with `remove()` or a bare
 *   unsubscribe function; legacy adapters / custom shims pick either.
 * BackHandler.addEventListener - Android hardware-back subscription
 *   factory. Returns a `remove()` subscription or a bare unsubscribe
 *   function.
 * Linking.addEventListener - Deep-link subscription factory. Returns
 *   a `remove()` subscription or a bare unsubscribe function; the
 *   handler may also fire with a `null` / `undefined` event on broken
 *   shims, so the event shape is widened to match.
 * Pressable - The React component class / function exposed as
 *   `Pressable` on the RN namespace. Monkey-patched by
 *   `PressableTracker` to wrap `onPress` props.
 * TouchableOpacity / TouchableHighlight / TouchableWithoutFeedback -
 *   Legacy touchable components patched alongside `Pressable` so
 *   apps that have not migrated to `Pressable` still emit
 *   `BUTTON_CLICK` events.
 */
import type { ComponentType } from 'react';

/**
 * Loose touchable-component type. We forward arbitrary props through
 * to the host's RN component without reading them ourselves, so the
 * exact prop shape is not part of our contract; using `Record<string,
 * unknown>` here would force every call site into a round-trip cast
 * at `createElement`. Limited to this file as an internal helper.
 */
type AnyComponentType = ComponentType<Record<string, unknown>>;

interface AppStateSubscription {
  remove: () => void;
}

interface BackHandlerSubscription {
  remove: () => void;
}

interface LinkingSubscription {
  remove: () => void;
}

interface RnApi {
  Platform?: {
    OS?: string;
  };
  AppState?: {
    addEventListener: (
      type: 'change',
      handler: (state: string) => void,
    ) => AppStateSubscription | (() => void);
  };
  BackHandler?: {
    addEventListener: (
      eventName: 'hardwareBackPress',
      handler: () => boolean | null | undefined,
    ) => BackHandlerSubscription | (() => void);
  };
  Linking?: {
    addEventListener: (
      type: 'url',
      handler: (event: { url?: string } | null | undefined) => void,
    ) => LinkingSubscription | (() => void);
  };
  Pressable?: AnyComponentType;
  TouchableOpacity?: AnyComponentType;
  TouchableHighlight?: AnyComponentType;
  TouchableWithoutFeedback?: AnyComponentType;
}

/**
 * Lazy loader returning the host `RnApi` or `undefined` when React
 * Native is unavailable (e.g. Node test runner without an RN install).
 * Trackers use the default loader at runtime; tests inject a custom
 * loader returning a hand-built mock.
 *
 * `undefined` (not `null`) per the project-wide convention - see
 * `shared/typescript.md` "Prefer undefined over null".
 */
type LoadRn = () => RnApi | undefined;

export type { AppStateSubscription, BackHandlerSubscription, LinkingSubscription, LoadRn, RnApi };

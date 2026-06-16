/**
 * pressable - The host's `react-native` Pressable component. Passing
 *   it as a prop (instead of importing from `react-native`) means
 *   `@keewano/react-native-sdk` does not have to take a hard
 *   dependency on `react-native` at TypeScript-type-check time, and
 *   unit tests can inject a fake without resolving the real module.
 * buttonName - Optional override for the BUTTON_CLICK payload. When
 *   omitted, the same resolver as `PressableTracker` runs over the
 *   passed-through props.
 *
 * All other props pass through unchanged to the wrapped Pressable.
 */
import { type ElementType, type ReactNode } from 'react';

/**
 * Intersection with `Record<string, unknown>` so typed consumers can
 * forward arbitrary `Pressable` props (`style`, `disabled`, `hitSlop`,
 * accessibility flags, ...) without the component's type narrowing
 * them away. The implementation already passes `...rest` through to
 * the wrapped Pressable; the type now matches the runtime contract.
 *
 * `pressable` is typed as React's own `ElementType` so it accepts
 * every shape `React.createElement` accepts: plain function / class
 * components, the `ForwardRefExoticComponent` shape react-native's
 * `Pressable` export uses, and the memo / lazy exotics React ships.
 * Narrower local types (`ComponentType<Record<string, unknown>>`)
 * reject real RN `Pressable` (a `ForwardRefExoticComponent<PressableProps
 * & RefAttributes<View>>`) under `strictFunctionTypes` due to
 * contravariant param checking; `ElementType` is the canonical
 * React-blessed escape hatch and pushes the structural variance
 * inside `@types/react` instead of our public surface.
 */
type KeewanoPressableExtraProps = Record<string, unknown> & {
  pressable: ElementType;
  buttonName?: string;
  testID?: string;
  accessibilityLabel?: string;
  children?: ReactNode;
  onPress?: (event: unknown) => void;
};

export type { KeewanoPressableExtraProps };

/**
 * Opt-in Pressable wrapper that emits a BUTTON_CLICK event regardless
 * of the `disableButtonTracking` flag. Hosts that have opted out of
 * the global `PressableTracker` monkey-patch can still annotate a
 * specific touchable with `<KeewanoPressable pressable={Pressable} ...>`
 * for explicit per-button tracking.
 *
 * The host's Pressable is passed as a prop rather than imported,
 * mirroring the structural-typing approach used throughout the SDK:
 * the lib has no static dependency on `react-native`, which keeps
 * the bundle slim and the unit tests hermetic.
 *
 * Double-emit guard: when the host has the global `PressableTracker`
 * enabled, the passed-in `pressable` carries the `__keewanoWrapped`
 * marker. In that case we forward `buttonName` straight through (the
 * tracker's `pickButtonName` reads it as the top priority) and let
 * the inner wrapper fire BUTTON_CLICK. The wrapper-not-active path
 * does the report itself, calling the same `pickButtonName` helper
 * the tracker uses so both paths produce identical labels.
 *
 * Wrapped via `forwardRef` so a caller-supplied ref reaches the
 * underlying Pressable. Hosts that rely on imperative Pressable
 * methods (`focus`, `measure`, animation hooks) need the forwarded ref
 * to stay attached; matches the same ref-forwarding discipline as the
 * global PressableTracker wrapper.
 */

import type { KeewanoPressableExtraProps } from './types/KeewanoPressable';

import { type ComponentType, type ReactElement, createElement, forwardRef } from 'react';

import { Keewano } from '../keewano';
import { pickButtonName } from '../trackers/PressableTracker';

/**
 * Render the host's Pressable with an `onPress` wrapper that reports
 * BUTTON_CLICK before invoking the caller's handler. When the host's
 * Pressable is the patched wrapper, forward `buttonName` through so
 * the inner wrapper emits the right label and skip our own emit.
 *
 * Missing-prop defence: a JS-only caller who omits the required
 * `pressable` prop renders nothing and a `console.error` surfaces
 * the misuse synchronously - matching the silent-degrade discipline
 * the rest of the SDK applies to user error.
 *
 * Preserve disabled / non-interactive controls: when the caller did
 * not supply `onPress`, do NOT inject a synthetic handler. Adding
 * one would turn an intentionally read-only Pressable into a
 * tappable element that emits BUTTON_CLICK, which both changes the
 * runtime behaviour and inflates analytics. Mirrors the same gate
 * the global PressableTracker wrapper applies on its render path.
 */
const KeewanoPressable = forwardRef<unknown, KeewanoPressableExtraProps>(
  function KeewanoPressable(props, ref): ReactElement | null {
    const { pressable, buttonName, onPress, ...rest } = props;
    if (pressable === undefined || pressable === null) {
      console.error('KeewanoPressable: required `pressable` prop is missing; rendering nothing.');
      return null;
    }
    /**
     * `KeewanoPressableExtraProps` widens to `Record<string, unknown>`
     * so typed consumers can forward arbitrary Pressable props; that
     * widening turns `props.pressable` into `unknown`, which the null
     * check then narrows to `{}` and createElement rejects. Re-assert
     * the structural component shape after the null check.
     */
    const Pressable = pressable as ComponentType<Record<string, unknown>>;
    /**
     * Build the spread once with the forwarded ref so every render
     * branch propagates the caller-supplied ref to the underlying
     * Pressable. Skip the `ref` key when the caller did not pass one,
     * so we do not clobber the wrapped component's default ref binding.
     * Typed as `Record<string, unknown>` because React's `createElement`
     * rejects an explicit `ref` field on the props object - the wrapped
     * `Pressable` is structurally typed and accepts arbitrary keys, so
     * the cast lines the runtime spread up with the structural contract.
     */
    const forwardedProps: Record<string, unknown> =
      ref === null || ref === undefined ? { ...rest } : { ...rest, ref };
    const isAlreadyTracked =
      (Pressable as unknown as { __keewanoWrapped?: boolean }).__keewanoWrapped === true;
    if (isAlreadyTracked) {
      /**
       * `buttonName` is forwarded as a custom prop. PressableLikeProps
       * lists it as the top priority in pickButtonName, so the inner
       * wrapper picks it up. RN's Pressable ignores unknown props, so
       * passing it through is safe.
       */
      return createElement(Pressable, {
        ...forwardedProps,
        buttonName,
        onPress,
      });
    }
    if (typeof onPress !== 'function') {
      return createElement(Pressable, forwardedProps);
    }
    const wrappedOnPress = (event: unknown): void => {
      try {
        /**
         * Only spread `buttonName` into the resolver when the host
         * actually passed a value: under `exactOptionalPropertyTypes`,
         * passing an explicit `undefined` is incompatible with the
         * `buttonName?: string` slot on `PressableLikeProps`.
         */
        const args =
          typeof buttonName === 'string' && buttonName.length > 0
            ? { ...rest, buttonName }
            : { ...rest };
        Keewano.reportButtonClick(pickButtonName(args));
      } catch {
        /** A throw from the report path must not block the host's onPress. */
      }
      onPress(event);
    };
    return createElement(Pressable, {
      ...forwardedProps,
      onPress: wrappedOnPress,
    });
  },
);

export type { KeewanoPressableExtraProps } from './types/KeewanoPressable';
export { KeewanoPressable };

/**
 * Builds the `forwardRef` wrapper that the `PressableTracker`
 * monkey-patch installs in place of `react-native`'s Pressable /
 * Touchable* exports. Kept in its own file so `PressableTracker.ts`
 * stays under the 150-line cap and so the wrapper-build concern
 * lives next to the related `pickButtonName` resolver.
 *
 * `forwardRef` is required so host code that uses `<Pressable
 * ref={...}>` keeps a valid ref to the underlying touchable. A
 * plain function component would silently drop the ref with a
 * dev-mode warning and break the host's `.focus()` / `.measure(...)`
 * calls.
 */

import type { BuildPressableWrapperArgs, PressableLikeProps } from './types/PressableTracker';

import {
  type ComponentType,
  type ForwardRefExoticComponent,
  type MemoExoticComponent,
  type RefAttributes,
  createElement,
  forwardRef,
  memo,
} from 'react';

import { KEvents, truncateString } from '@keewano/core';

import { pickButtonName } from './pickButtonName';
import { stampNowOnDispatcher } from './stampNow';

/**
 * Loose touchable-component type. `Record<string, unknown>` is the
 * widest prop type `createElement` accepts: the wrapper never reads
 * the props itself, it only intercepts `onPress`, so the precise
 * host Pressable prop shape is not part of our contract. Defined
 * once here and re-exported so `PressableTracker.ts` and tests share
 * one alias.
 */
type WrappedTouchable = ComponentType<Record<string, unknown>>;

type WrappedForwardRef = ForwardRefExoticComponent<
  Record<string, unknown> & RefAttributes<unknown>
>;

type WrappedMemo = MemoExoticComponent<WrappedForwardRef>;

/**
 * Build a `forwardRef` wrapper around `original` that intercepts
 * `onPress` and emits a BUTTON_CLICK event before delegating. Tagged
 * with `__keewanoWrapped` so `detach()` can verify the namespace
 * still points at our patch before restoring the original.
 *
 * The dispatcher is resolved per press, never captured: a mounted
 * screen keeps rendering the wrapper reference already in its element
 * tree, so a wrapper built by one init survives that init's shutdown
 * and must route later presses to whatever session is live at the
 * time (and drop them while none is).
 *
 * The result is memoized because the touchables it replaces already
 * are: React Native exports `Pressable` as `memo(Pressable)`, and this
 * wrapper hands it a freshly built `onPress` on every render, which
 * misses that memo every time. Unpatched, a parent re-render with
 * unchanged props skipped the touchable entirely; memoizing here
 * restores exactly that, because a wrapper that does not re-render
 * builds no new handler. A host passing an inline arrow misses either
 * way, patched or not.
 */
function buildPressableWrapper({
  original: Original,
  componentLabel,
  resolveDispatcher,
}: BuildPressableWrapperArgs): WrappedTouchable {
  const KeewanoTouchable: WrappedForwardRef = forwardRef<
    unknown,
    PressableLikeProps & Record<string, unknown>
  >(function KeewanoTouchable(props, ref): ReturnType<typeof createElement> {
    const forwardedProps: Record<string, unknown> =
      ref === null || ref === undefined ? { ...props } : { ...props, ref };
    /**
     * If the host passed no handler (or `onPress={undefined}` to
     * visually-disable the button), stay invisible: do NOT wrap.
     * Wrapping would emit BUTTON_CLICK on every tap of an
     * intentionally-disabled button and inflate click-funnel
     * metrics.
     */
    if (typeof props.onPress !== 'function') {
      return createElement(Original, forwardedProps);
    }
    const hostOnPress = props.onPress;
    forwardedProps['onPress'] = (event: unknown): void => {
      try {
        const dispatcher = resolveDispatcher();
        if (dispatcher !== null) {
          stampNowOnDispatcher(dispatcher);
          dispatcher.addEventString({
            eventId: KEvents.BUTTON_CLICK,
            str: truncateString(pickButtonName(props)),
          });
        }
      } catch {
        /** A throw from the dispatcher must not block the host's onPress. */
      }
      hostOnPress(event);
    };
    return createElement(Original, forwardedProps);
  });
  KeewanoTouchable.displayName = `KeewanoTracked(${componentLabel})`;
  /**
   * Tag the memo, not the inner render: the namespace holds the memo,
   * and that is what `detach` inspects before restoring an original.
   */
  const Memoized: WrappedMemo = memo(KeewanoTouchable);
  Memoized.displayName = KeewanoTouchable.displayName;
  (Memoized as unknown as { __keewanoWrapped: true }).__keewanoWrapped = true;
  return Memoized as unknown as WrappedTouchable;
}

export type { WrappedTouchable };
export { buildPressableWrapper };

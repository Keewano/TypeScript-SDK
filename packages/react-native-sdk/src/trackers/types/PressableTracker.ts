/**
 * dispatcher - Live event accumulator. The tracker emits a
 *   BUTTON_CLICK event string per `onPress` fire.
 * loadRn - Optional injection point for tests. Defaults to the
 *   lazy `require('react-native')` loader.
 */
import type { KEventDispatcher } from '@keewano/core';

import type { WrappedTouchable } from '../pressableWrapper';

import type { LoadRn } from './rn';

interface PressableTrackerArgs {
  dispatcher: KEventDispatcher;
  loadRn?: LoadRn;
}

/**
 * Per-key record kept by `patchTouchables` so detach can restore the
 * exact wrapper this tracker installed. Identity-equality on `wrapped`
 * keeps restore strictly scoped: a foreign patcher that chained on top
 * (even one carrying the same `__keewanoWrapped` marker) is left in
 * place rather than ripped out.
 *
 * original - The host's component reference captured at attach.
 * wrapped - The forwardRef wrapper we installed in its slot.
 */
interface PatchedSlot {
  original: WrappedTouchable;
  wrapped: WrappedTouchable;
}

/**
 * Subset of `Pressable` / Touchable* props the tracker reads. Defined
 * structurally so a single button-name resolver works for every
 * touchable family.
 *
 * `buttonName` is a non-standard prop the SDK uses internally to
 * thread an explicit analytics label from `<KeewanoPressable>` to
 * the global tracker. RN's Pressable ignores unknown props at
 * runtime, so passing it through is safe. It is listed at the top
 * of the resolution priority so that an explicit caller-supplied
 * label always wins over the testID / accessibilityLabel fallbacks.
 */
interface PressableLikeProps {
  buttonName?: string;
  testID?: string;
  accessibilityLabel?: string;
  children?: unknown;
  onPress?: (event: unknown) => void;
}

export type { PatchedSlot, PressableLikeProps, PressableTrackerArgs };

/**
 * Pressable / Touchable* auto-tracker. Monkey-patches the host's
 * `react-native` namespace so every `<Pressable>`, `<TouchableOpacity>`,
 * `<TouchableHighlight>`, and `<TouchableWithoutFeedback>` press
 * emits a BUTTON_CLICK event without the host having to call
 * `Keewano.reportButtonClick(...)` per button.
 *
 * The patch wraps the component reference so it works for both
 * function-component and forwardRef-component exports across RN
 * versions. The wrapper logic lives in `pressableWrapper.ts`; this
 * file owns only the per-key iteration + detach discipline.
 *
 * Detach restores the originals iff the namespace still points at
 * our wrapper. If another monkey-patcher chained on top after us,
 * we leave their patch in place rather than ripping it out (we
 * would otherwise corrupt their tracking).
 */

import type { KeewanoTracker } from '../types/config';

import type { WrappedTouchable } from './pressableWrapper';
import type { PatchedSlot, PressableTrackerArgs } from './types/PressableTracker';
import type { RnApi } from './types/rn';

import { defaultLoadRn } from './loadRn';
import { noopDetach } from './noopDetach';
import { buildPressableWrapper } from './pressableWrapper';

/** Touchable namespace keys the tracker patches. */
const TOUCHABLE_KEYS = [
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
] as const satisfies ReadonlyArray<keyof RnApi>;

type TouchableKey = (typeof TOUCHABLE_KEYS)[number];

/**
 * Writable view of the RnApi for the touchable slots we mutate.
 * `RnApi` is read-only via the structural shape but the real
 * `react-native` module exposes them as configurable accessors; the
 * single typed alias here replaces four scattered `as unknown as
 * Record<...>` casts in the patch + restore loops.
 */
type TouchableSlots = Record<TouchableKey, WrappedTouchable>;

/**
 * Args for the private `defineSlot` helper. Kept as a local-only type
 * because the shape is consumed by exactly one private helper below
 * and depends on the impl-local `TouchableSlots` / `TouchableKey`
 * aliases, so it has no use outside this file.
 *
 * slots - Writable view of the touchable namespace.
 * key - Touchable slot to (re)define.
 * value - Component reference to install in the slot.
 */
interface DefineSlotArgs {
  slots: TouchableSlots;
  key: TouchableKey;
  value: WrappedTouchable;
}

/**
 * Install `value` into a touchable slot via `defineProperty`. The
 * `react-native` namespace exposes each Touchable as a configurable
 * getter-only accessor (Babel / Metro ESM interop), so a plain
 * `slots[key] = value` assignment throws in this strict-mode module
 * ("only a getter"). `defineProperty` redefines the configurable slot
 * in place, which works for both the accessor case and a plain
 * writable data property. Stays configurable + writable so detach (and
 * any later patcher) can replace it again.
 */
function defineSlot({ slots, key, value }: DefineSlotArgs): void {
  Object.defineProperty(slots, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

class PressableTracker implements KeewanoTracker {
  readonly name = 'PressableTracker';

  private readonly args: PressableTrackerArgs;

  constructor(args: PressableTrackerArgs) {
    this.args = args;
  }

  /**
   * Patch every touchable component on the resolved RN namespace and
   * return a detach that restores the originals. If RN is absent
   * (Node test runner / non-RN host) the attach returns a no-op
   * detach so the SDK boot survives.
   */
  attach(): () => void {
    const load = this.args.loadRn ?? defaultLoadRn;
    /** A throwing custom `loadRn` must degrade rather than crash SDK boot. */
    let rn: ReturnType<typeof load>;
    try {
      rn = load();
    } catch {
      return noopDetach;
    }
    /** `== null` so a custom `loadRn` returning `null` degrades the same as `undefined`. */
    if (rn == null) return noopDetach;
    const slots = rn as unknown as TouchableSlots;
    const originals = patchTouchables(slots, this.args.dispatcher);
    return () => restoreTouchables(slots, originals);
  }
}

/**
 * Iterate every touchable key. Skip when the slot is empty or when
 * it already carries our wrapper marker (aliased namespaces like
 * react-native-web's `TouchableOpacity === Pressable` would otherwise
 * produce wrapper-of-wrapper double-emits). The defineProperty install
 * is wrapped in try/catch so a non-configurable slot does not abort
 * the loop and orphan an already-installed wrapper.
 */
function patchTouchables(
  slots: TouchableSlots,
  dispatcher: PressableTrackerArgs['dispatcher'],
): Map<TouchableKey, PatchedSlot> {
  const originals = new Map<TouchableKey, PatchedSlot>();
  for (const key of TOUCHABLE_KEYS) {
    const Original = slots[key];
    /** `== null` covers both `undefined` (missing) and `null` (some host shims). */
    if (Original == null) continue;
    if ((Original as unknown as { __keewanoWrapped?: boolean }).__keewanoWrapped === true) {
      continue;
    }
    try {
      /**
       * Build the wrapper inside the guarded block so a single malformed
       * Touchable export (e.g. one that crashes its forwardRef factory)
       * does not abort the loop and orphan an already-installed wrapper
       * for the other keys.
       */
      const Wrapped = buildPressableWrapper(Original, key, dispatcher);
      defineSlot({ slots, key, value: Wrapped });
      originals.set(key, { original: Original, wrapped: Wrapped });
    } catch (err: unknown) {
      console.warn(
        `Keewano: PressableTracker could not patch "${key}" (non-configurable slot?); skipping.`,
        err,
      );
    }
  }
  return originals;
}

/**
 * Restore every originally-patched slot, but only when the current
 * value is still the exact wrapper this tracker installed. A
 * different wrapper that carries the same `__keewanoWrapped` marker
 * (another bundle, a later patcher) MUST NOT be ripped out by our
 * detach: identity-equality keeps the restore strictly scoped to the
 * patch this instance produced.
 */
function restoreTouchables(slots: TouchableSlots, originals: Map<TouchableKey, PatchedSlot>): void {
  for (const [key, entry] of originals) {
    if (slots[key] !== entry.wrapped) continue;
    try {
      defineSlot({ slots, key, value: entry.original });
    } catch {
      /** Non-configurable slot; best-effort restore. */
    }
  }
}

export type { PressableTrackerArgs } from './types/PressableTracker';
export { pickButtonName } from './pickButtonName';
export { PressableTracker };

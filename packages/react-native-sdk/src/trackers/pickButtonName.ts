/**
 * Shared button-name resolver used by both the global
 * `PressableTracker` monkey-patch and the explicit
 * `<KeewanoPressable>` component. Centralising the priority ladder
 * here means the two emit paths always produce the same label for
 * the same button - no drift between the auto-tracked path and the
 * opt-in component when one is updated without the other.
 *
 * Preference order:
 *   1. `buttonName`        (explicit SDK-internal label - wins when set)
 *   2. `testID`            (developer-controlled, stable across locales)
 *   3. `accessibilityLabel` (developer-controlled, often present)
 *   4. children            (only when it is a single string literal)
 *   5. ANONYMOUS sentinel
 *
 * `buttonName` is at the top because `<KeewanoPressable buttonName="X" />`
 * forwards the prop through the wrapped Pressable so both the global
 * tracker path AND the explicit component path resolve to the same
 * label. Hosts that do NOT use `<KeewanoPressable>` never pass
 * `buttonName`, so the rest of the ladder is unchanged for plain
 * `<Pressable>` usage.
 *
 * Children resolution intentionally does NOT walk through Text /
 * Pressable / etc. nested elements - that would emit noisy / unstable
 * names like `[object Object]` for any non-trivial tree.
 */

import type { PressableLikeProps } from './types/PressableTracker';

/** Button name reported when no source is meaningful. */
const ANONYMOUS = 'Anonymous';

function pickButtonName(props: PressableLikeProps): string {
  if (typeof props.buttonName === 'string' && props.buttonName.length > 0) return props.buttonName;
  if (typeof props.testID === 'string' && props.testID.length > 0) return props.testID;
  if (typeof props.accessibilityLabel === 'string' && props.accessibilityLabel.length > 0) {
    return props.accessibilityLabel;
  }
  if (typeof props.children === 'string' && props.children.length > 0) return props.children;
  return ANONYMOUS;
}

export { ANONYMOUS, pickButtonName };

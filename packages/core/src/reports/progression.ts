/**
 * Cross-platform progression signals: onboarding milestones (with a
 * per-name dedup counter) and A/B test group assignment. Both are pure
 * dispatcher emission with no platform coupling, so React Native and
 * Node share them.
 */

import type { ReportABTestGroupAssignmentArgs } from './types/progression';

import { KEvents } from '../events';

import { MAX_STRING_LENGTH, runWhenReady, truncateString } from './reportHelpers';

/**
 * Emit an `ONBOARDING_MILESTONE` event with a dedup-counter suffix.
 * Repeated calls with the same name produce `"name"`, `"name (#2)"`,
 * `"name (#3)"`, ... so the server can distinguish them at the cost
 * of a stable wire string.
 *
 * Counter lives in `runtime.onboardingCounters` so `Keewano.shutdown()`
 * + `Keewano.init()` resets it - module-scope storage would survive
 * shutdown and corrupt dedup for tests / Fast Refresh.
 */
function reportOnboardingMilestone(name: string): void {
  const truncated = truncateString(name);
  runWhenReady((runtime) => {
    /**
     * Key the dedup counter by the RAW `name`, not the truncated
     * label. Two distinct milestones that share their first 256
     * characters would otherwise collide on the truncated key and
     * share a counter, producing wrong `(#N)` suffix values on the
     * wire for both. Truncation still applies to the emitted
     * payload (the wire field is bounded), but the in-memory
     * dedup keeps each distinct caller-side identifier separate.
     */
    const seen = runtime.onboardingCounters.get(name) ?? 0;
    const next = seen + 1;
    runtime.onboardingCounters.set(name, next);
    if (next === 1) {
      runtime.dispatcher.addEventString({
        eventId: KEvents.ONBOARDING_MILESTONE,
        str: truncated,
      });
      return;
    }
    /**
     * Reserve room for the " (#N)" suffix before composing the final
     * label so a 256-char milestone name still produces a distinct
     * payload on every repeat. Without this, truncateString(label)
     * would strip the suffix and every repeat would collapse back to
     * the same bytes, defeating the dedup signal.
     */
    const suffix = ` (#${String(next)})`;
    const base = truncated.slice(0, Math.max(0, MAX_STRING_LENGTH - suffix.length));
    runtime.dispatcher.addEventString({
      eventId: KEvents.ONBOARDING_MILESTONE,
      str: `${base}${suffix}`,
    });
  });
}

/**
 * Emit an `AB_TEST_ASSIGNMENT` event. The wire payload is the test
 * name as a string event followed by the group letter as ONE raw
 * UTF-8 byte (no length prefix). The dispatcher has no public
 * `addEventChar`, so the string event is emitted first and the
 * single byte is appended directly into the in-batch buffer - the
 * two writes share one event-header timestamp.
 *
 * Only ASCII group letters (`[0x00, 0x7F]`) are supported on the
 * wire; non-ASCII / multi-byte chars short-circuit the call so the
 * server never sees a malformed payload. A/B test group names are
 * conventionally `'A'`, `'B'`, ... so this is not a practical
 * limitation.
 */
function reportABTestGroupAssignment({ testName, group }: ReportABTestGroupAssignmentArgs): void {
  /**
   * Fail-soft on non-string inputs, matching `reportSceneLoaded` /
   * `reportSceneUnloaded`. The TS signature pins both to `string`, but
   * untyped JS hosts can hand us `null` / `undefined` / objects, and
   * `group.length` / `truncateString(testName)` would otherwise throw
   * out into the host's call site instead of dropping the report.
   */
  if (typeof testName !== 'string' || typeof group !== 'string') return;
  /**
   * Require an exact single-character ASCII group. Multi-character
   * inputs like 'AB' would otherwise silently emit only the first
   * code unit, mis-attributing experiment exposure on the wire. An
   * empty string has no first code point and is also rejected.
   */
  if (group.length !== 1) return;
  const charCode = group.codePointAt(0);
  if (charCode === undefined || charCode > 0x7f) return;
  runWhenReady((runtime) => {
    runtime.dispatcher.addEventStringChar({
      eventId: KEvents.AB_TEST_ASSIGNMENT,
      str: truncateString(testName),
      charCode,
    });
  });
}

export type { ReportABTestGroupAssignmentArgs } from './types/progression';
export { reportABTestGroupAssignment, reportOnboardingMilestone };

/**
 * UI tracking methods: button clicks, window open/close, onboarding
 * milestones (with dedup counter), AB test group assignment. Each
 * method emits one event record onto the dispatcher.
 */

import type { ReportABTestGroupAssignmentArgs } from './types/ui';

import { KEvents } from '@keewano/core';

import { MAX_STRING_LENGTH, runWhenReady, truncateString } from './reportHelpers';

/**
 * Emit a `BUTTON_CLICK` event with the (truncated) button name as
 * payload. Truncation keeps the wire payload bounded at 256 chars.
 */
function reportButtonClick(name: string): void {
  runWhenReady((runtime) => {
    runtime.dispatcher.addEventString({
      eventId: KEvents.BUTTON_CLICK,
      str: truncateString(name),
    });
  });
}

/** Emit a `WINDOW_OPEN` event with the (truncated) window name. */
function reportWindowOpen(name: string): void {
  runWhenReady((runtime) => {
    runtime.dispatcher.addEventString({
      eventId: KEvents.WINDOW_OPEN,
      str: truncateString(name),
    });
  });
}

/** Emit a `WINDOW_CLOSE` event with the (truncated) window name. */
function reportWindowClose(name: string): void {
  runWhenReady((runtime) => {
    runtime.dispatcher.addEventString({
      eventId: KEvents.WINDOW_CLOSE,
      str: truncateString(name),
    });
  });
}

/**
 * Emit a `SCENE_LOADED` event with the (truncated) scene / route name.
 * Used by the navigation hooks (`useKeewanoNavigation`) to report
 * full-screen route transitions; distinct from
 * {@link reportWindowOpen}, which is for in-screen modals / popups.
 *
 * Blank / whitespace-only names short-circuit. A direct host call with
 * an empty string would otherwise emit a zero-length wire event AND
 * pin `runtime.lastSceneName=''`, which the next transition's
 * `previous` check (`previous !== undefined`) would treat as a real
 * scene and emit a bogus `SCENE_UNLOADED('')` for it.
 */
function reportSceneLoaded(name: string): void {
  /**
   * `name.trim()` throws `TypeError` on `null` / `undefined` / objects.
   * The TS signature pins the input to `string`, but untyped JS hosts
   * (and tests / tooling that bypass TS) can still feed bad values.
   * Degrade to a no-op instead of crashing the host app.
   */
  if (typeof name !== 'string') return;
  const normalized = name.trim();
  if (normalized.length === 0) return;
  runWhenReady((runtime) => {
    runtime.dispatcher.addEventString({
      eventId: KEvents.SCENE_LOADED,
      str: truncateString(normalized),
    });
    /**
     * Persist the scene cursor at emission time so a queued call (the
     * hook fires during init, before the runtime exists) lands the
     * cursor write together with the SCENE_LOADED event. The hook's
     * own `writeSceneCursor` is a no-op while `runtime` is null, so
     * without this line the cursor would stay `undefined` and the
     * next transition would skip its SCENE_UNLOADED.
     */
    runtime.lastSceneName = normalized;
  });
}

/**
 * Emit a `SCENE_UNLOADED` event with the (truncated) scene / route name.
 *
 * Blank / whitespace-only names short-circuit (same rationale as
 * `reportSceneLoaded`: a blank name would otherwise emit a noise
 * wire event and, if the cursor happened to be blank too, would
 * wrongly clear it).
 */
function reportSceneUnloaded(name: string): void {
  /**
   * Same fail-soft guard as `reportSceneLoaded` - untyped JS callers
   * can hand us `null` / `undefined` / an object and `.trim()` would
   * otherwise throw out into the host's call site.
   */
  if (typeof name !== 'string') return;
  const normalized = name.trim();
  if (normalized.length === 0) return;
  runWhenReady((runtime) => {
    runtime.dispatcher.addEventString({
      eventId: KEvents.SCENE_UNLOADED,
      str: truncateString(normalized),
    });
    /**
     * Clear the scene cursor when the standalone unload matches the
     * currently tracked scene. Without this, a direct
     * `reportSceneUnloaded(name)` call (outside `useKeewanoNavigation`)
     * leaves `runtime.lastSceneName` stale, so the next navigation
     * change would emit a duplicate SCENE_UNLOADED for a scene that
     * was already closed. `lastSceneName` is always written as the
     * trimmed (untruncated) name, so a normalized-name match is
     * sufficient.
     */
    if (runtime.lastSceneName === normalized) {
      runtime.lastSceneName = undefined;
    }
  });
}

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
    runtime.dispatcher.addEventString({
      eventId: KEvents.AB_TEST_ASSIGNMENT,
      str: truncateString(testName),
    });
    runtime.dispatcher.currentInBatch.data.writeUint8(charCode);
  });
}

export type { ReportABTestGroupAssignmentArgs } from './types/ui';
export {
  reportABTestGroupAssignment,
  reportButtonClick,
  reportOnboardingMilestone,
  reportSceneLoaded,
  reportSceneUnloaded,
  reportWindowClose,
  reportWindowOpen,
};

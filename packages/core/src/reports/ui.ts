/**
 * Cross-platform UI tracking signals: button clicks and window
 * open / close. Pure dispatcher emission with no platform coupling,
 * so every platform facade shares one wire-policy source.
 */

import { KEvents } from '../events';

import { runWhenReady, truncateString } from './reportHelpers';

/**
 * Emit a `BUTTON_CLICK` event with the (truncated) button name as
 * payload. Truncation keeps the wire payload bounded at 256 chars.
 */
function reportButtonClick(name: string): void {
  /**
   * Fail-soft on non-string input, matching
   * `reportABTestGroupAssignment`: the TS signature pins `name` to
   * `string`, but untyped JS hosts can pass `null` / objects, and
   * `truncateString` would then throw into the host's call site.
   */
  if (typeof name !== 'string') return;
  runWhenReady((runtime) => {
    runtime.dispatcher.addEventString({
      eventId: KEvents.BUTTON_CLICK,
      str: truncateString(name),
    });
  });
}

/** Emit a `WINDOW_OPEN` event with the (truncated) window name. */
function reportWindowOpen(name: string): void {
  /** Same fail-soft guard as `reportButtonClick`. */
  if (typeof name !== 'string') return;
  runWhenReady((runtime) => {
    runtime.dispatcher.addEventString({
      eventId: KEvents.WINDOW_OPEN,
      str: truncateString(name),
    });
  });
}

/** Emit a `WINDOW_CLOSE` event with the (truncated) window name. */
function reportWindowClose(name: string): void {
  /** Same fail-soft guard as `reportButtonClick`. */
  if (typeof name !== 'string') return;
  runWhenReady((runtime) => {
    runtime.dispatcher.addEventString({
      eventId: KEvents.WINDOW_CLOSE,
      str: truncateString(name),
    });
  });
}

export { reportButtonClick, reportWindowClose, reportWindowOpen };

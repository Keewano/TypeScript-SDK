/**
 * Shared detach callback returned by every tracker whose `attach()`
 * could not install its listener / patch (e.g. RN module unavailable
 * in a Node test runner, ErrorUtils missing on web hosts, optional
 * NetInfo peer not installed). Pulled into one file so the 7 tracker
 * modules do not each declare an identical no-op - mirrors the
 * "no duplicate code" rule and gives a single insertion point for
 * any future detach-side telemetry.
 */
function noopDetach(): void {
  /** Intentional no-op: nothing was subscribed or patched. */
}

export { noopDetach };

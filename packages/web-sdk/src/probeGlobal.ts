/**
 * Structural probe for the browser surfaces the SDK reaches for
 * (`window`, `document`, `navigator.locks`, `localStorage`). Every one
 * of them can be missing, partial, or - in a sandboxed or proxied
 * realm - hidden behind a getter that throws instead of returning
 * undefined, and each caller degrades rather than fails when that
 * happens. The probe is the single place that contract lives: it
 * returns `null` for every one of those shapes and never throws.
 */
import type { ProbeGlobalArgs } from './types/probeGlobal';

/** The listener pair every event-target surface must provide. */
const EVENT_TARGET_METHODS = ['addEventListener', 'removeEventListener'] as const;

/**
 * @returns The probed surface typed as `T`, or `null` when the host
 *   cannot supply it. Never throws.
 */
function probeGlobal<T>({ path = [], methods = [], accept }: ProbeGlobalArgs<T>): T | null {
  try {
    let value: unknown = globalThis;
    for (const key of path) {
      value = (value as Record<string, unknown> | null | undefined)?.[key];
    }
    if (value === null || value === undefined) return null;
    const surface = value as Record<string, unknown>;
    for (const name of methods) {
      if (typeof surface[name] !== 'function') return null;
    }
    const probed = value as T;
    return accept === undefined || accept(probed) ? probed : null;
  } catch {
    return null;
  }
}

export { EVENT_TARGET_METHODS, probeGlobal };

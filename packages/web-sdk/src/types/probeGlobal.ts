/** Args type for the browser-global probe; see `probeGlobal`. */

/**
 * path - Property chain from `globalThis` down to the surface being
 *   probed (`['document']`, `['navigator', 'locks']`); omitted probes
 *   the global object itself.
 * methods - Names that must resolve to functions on the probed
 *   surface; anything else fails the probe. Omitted means presence is
 *   the whole requirement.
 * accept - Extra requirement for surfaces whose shape check is not
 *   just method names; runs inside the probe's own containment, so it
 *   may touch properties whose getters throw.
 */
interface ProbeGlobalArgs<T> {
  path?: readonly string[];
  methods?: readonly (keyof T & string)[];
  accept?: (value: T) => boolean;
}

export type { ProbeGlobalArgs };

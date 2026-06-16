/**
 * Ad format taxonomy used by the ad-revenue and ad-offered events.
 *
 * Consumed by `reportAdOffered` / `reportAdRevenue` to qualify the
 * placement that drove the revenue or impression. Serialized as a
 * single uint8 byte on the wire.
 *
 * @example
 * ```ts
 * import { AdType } from '@keewano/core';
 *
 * AdType.Rewarded;     // 1
 * AdType.Interstitial; // 2
 * AdType.Banner;       // 3
 * ```
 */

/**
 * Wire-protocol ad-type codes.
 *
 * - Rewarded - user opts in to watch in exchange for an in-game reward.
 * - Interstitial - full-screen ad shown at a transition point.
 * - Banner - small persistent ad rendered alongside game UI.
 * - Playable - interactive mini-game ad unit.
 * - Offerwall - list of tasks/offers granting rewards on completion.
 *
 * Value is a uint8 on the wire (1 byte).
 */
const AdType = {
  Rewarded: 1,
  Interstitial: 2,
  Banner: 3,
  Playable: 4,
  Offerwall: 5,
} as const;

/**
 * Union of all valid `AdType` numeric values.
 */
type AdTypeValue = (typeof AdType)[keyof typeof AdType];

export type { AdTypeValue };
export { AdType };

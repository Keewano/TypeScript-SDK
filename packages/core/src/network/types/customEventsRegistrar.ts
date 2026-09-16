/**
 * Contract for the pluggable custom-events registration protocol.
 *
 * The send loop must confirm the server knows the session's
 * custom-events map before shipping any batch that references custom
 * ids, and every batch encoding has its own registration protocol
 * (the binary transport probes and registers over `/custom` with
 * K-* headers; the REST transport uses `/event/ingress/v1/json/custom`). A
 * `CustomEventsRegistrar` is the loop-facing seam: it is paired with
 * the transport at wiring time, and the loop drives the same
 * probe-then-register orchestration through it regardless of
 * protocol.
 *
 * `getStatus` probes whether the server already knows the map
 * version; `register` uploads the map. Both mirror the error
 * contracts of the binary implementations they abstract:
 * configuration bugs throw, cancellation propagates, transient
 * failures collapse into `'error'` / `false`.
 */

import type {
  CustomEventMapStatus,
  GetCustomEventMapStatusArgs,
  RegisterCustomEventMapArgs,
} from './customEventMap';

/**
 * codecId - id of the codec whose registration protocol this
 *   registrar speaks. The send loop validates it against the paired
 *   transport's `codecId` at startup, so a registrar wired against
 *   the wrong protocol fails loudly at boot instead of probing the
 *   wrong endpoint on every tick.
 */
interface CustomEventsRegistrar {
  readonly codecId: string;
  getStatus(args: GetCustomEventMapStatusArgs): Promise<CustomEventMapStatus>;
  register(args: RegisterCustomEventMapArgs): Promise<boolean>;
}

export type { CustomEventsRegistrar };

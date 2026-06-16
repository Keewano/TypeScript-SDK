import type { CustomEventTypeValue } from '../../events/customEventType';

/**
 * One declared custom event, in declaration order. The array position
 * in {@link CustomEventSet.events} is the wire-id offset: the Nth entry
 * is event id `2500 + N`. Carried in readable form (not just inside the
 * gzip blob) so the runtime can resolve a name to its id and payload
 * type when the host emits the event, without inflating the map.
 *
 * name - Event name exactly as declared (codegen sorts events
 *   ordinal-by-name, which fixes the index and therefore the id).
 * type - Payload shape; tells the runtime which dispatcher overload to
 *   call.
 */
interface CustomEventDef {
  name: string;
  type: CustomEventTypeValue;
}

/**
 * Custom-events map payload passed to `registerCustomEventMap` and to
 * `Keewano.init({ customEventSet })`.
 *
 * version - FNV-1a 32-bit hash of the gzip-normalized map bytes.
 *   Sent as `K-CustomEventHash`. Must match the `customEventsVersion`
 *   stamped on every batch that references this map.
 * gzipData - Gzip-compressed map bytes, pre-compressed at codegen time
 *   and embedded in the generated runtime code. The network layer
 *   ships these bytes verbatim. The gzip header bytes 4..9 must be
 *   normalized before hashing (MTIME=0, XFL=0, OS=0xFF) so the
 *   fingerprint matches across operating systems.
 * eventCount - Number of events declared in the map. Sent as
 *   `K-CustomEventCount` (decimal uint16).
 * events - Declared events in id order, used by the runtime to resolve
 *   a `reportCustomEvent` name to its id and payload type. Optional so
 *   a set built only for registration (e.g. a transport smoke) stays
 *   valid; codegen always emits it so generated maps can report events.
 */
interface CustomEventSet {
  version: number;
  gzipData: Uint8Array;
  eventCount: number;
  events?: ReadonlyArray<CustomEventDef>;
}

export type { CustomEventDef, CustomEventSet };

import type { CustomEventTypeValue } from '../../events/customEventType';

/**
 * One declared custom event, in id order. Carried in readable form (not
 * just inside the gzip blob) so the runtime can resolve a name to its id
 * and payload type when the host emits the event, without inflating the
 * map.
 *
 * id - Wire event id as the generator assigned it: events are numbered
 *   by their position in the definitions file, and removing one moves
 *   every later event down, so a regenerated set never skips a number.
 *   Absent only in a module generated before the id was emitted; those
 *   sets were numbered by position, which is what the runtime falls
 *   back to. Resolve it through `customEventIdAt`, never off the array
 *   position.
 * name - Event name exactly as declared.
 * type - Payload shape; tells the runtime which dispatcher overload to
 *   call.
 */
interface CustomEventDef {
  id?: number | undefined;
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
 *   a `reportCustomEvent` name to its id and payload type. Optional
 *   only for the binary registration protocol, which uploads
 *   `gzipData`; JSON registration builds its body from these entries
 *   and cannot register a set without them. Codegen always emits it,
 *   with exactly `eventCount` entries. The runtime indexes the set on
 *   first use, so the entries must not be edited after init.
 */
interface CustomEventSet {
  version: number;
  gzipData: Uint8Array;
  eventCount: number;
  events?: ReadonlyArray<CustomEventDef>;
}

export type { CustomEventDef, CustomEventSet };

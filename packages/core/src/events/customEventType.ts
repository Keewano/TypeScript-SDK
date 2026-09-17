/**
 * Payload-shape tags for user-defined custom events.
 *
 * The codegen tool emits one entry per custom event into a binary map;
 * each entry pairs an event name with one of these type tags so the
 * server knows how to parse the payload bytes that follow the event ID
 * at runtime. Mirrors the closed set of payload shapes the wire
 * protocol understands.
 *
 * @example
 * ```ts
 * import { CustomEventType } from '@keewano/core';
 *
 * CustomEventType.None;             // 0
 * CustomEventType.String;           // 1
 * CustomEventType.PriceInUSDCents;  // 6
 * ```
 */

/**
 * Wire-protocol payload-shape codes.
 *
 * - None - the event carries no payload.
 * - String - varint-prefixed UTF-8 string follows the event ID.
 * - UnsignedInt - uint32 LE follows the event ID.
 * - Bool - one byte 0x02/0x01 follows the event ID.
 * - Timestamp - uint32 LE Unix seconds (UTC) follows the event ID.
 * - UnsignedShortVec2 - two uint16 LE values follow the event ID.
 * - PriceInUSDCents - uint32 LE cents follows the event ID.
 *
 * Values are uint16 LE on the wire.
 */
const CustomEventType = {
  None: 0,
  String: 1,
  UnsignedInt: 2,
  Bool: 3,
  Timestamp: 4,
  UnsignedShortVec2: 5,
  PriceInUSDCents: 6,
} as const;

/**
 * First wire id assigned to custom events; the Nth declared event is
 * `2500 + N`. The server reserves ids 2000 and above for custom
 * events, so the whole derived range is valid on every transport.
 */
const CUSTOM_EVENT_BASE = 2500;

/**
 * Lowest id a custom event may claim.
 *
 * Everything below belongs to the built-in events. The generator never
 * assigns one, but a hand-built set or an edited generated module can
 * declare an id below the range and name one of them. Nothing
 * downstream would notice: the id travels as the event id, and a
 * custom payload filed under a built-in number is indistinguishable
 * from the real thing once it is on the wire. The server draws the
 * same line and says so when it refuses a map.
 */
const CUSTOM_EVENT_MIN_ID = 2000;

/**
 * Is `id` inside the range custom events may use?
 *
 * @param id - The declared id from a generated or hand-built set.
 */
function isCustomEventId(id: number): boolean {
  return Number.isInteger(id) && id >= CUSTOM_EVENT_MIN_ID;
}

/**
 * Union of all valid `CustomEventType` numeric values.
 */
type CustomEventTypeValue = (typeof CustomEventType)[keyof typeof CustomEventType];

/**
 * Wire names of the payload shapes, spelled as the ingestion API
 * spells them. Two places carry the name: the registration body,
 * and every custom event on the JSON wire.
 *
 * The spelling of each is fixed by the server, which rejects an
 * unknown name with the full list it accepts. Getting one wrong in a
 * registration is not a partial failure: the whole registration is
 * rejected and the send loop ships nothing at all, because a batch
 * referencing an unregistered map is refused outright.
 *
 * On an event the failure is quieter. The service validates each
 * custom event against the name the event itself carries and never
 * consults the registered map, so an event with no name is dropped
 * while the rest of the batch is accepted, and one whose name
 * disagrees with its declaration is accepted and decoded as the
 * wrong type.
 */
const CUSTOM_EVENT_DATA_TYPE_NAME: Readonly<Record<number, string>> = {
  [CustomEventType.None]: 'none',
  [CustomEventType.String]: 'string',
  [CustomEventType.UnsignedInt]: 'uint',
  [CustomEventType.Bool]: 'bool',
  [CustomEventType.Timestamp]: 'timestamp',
  [CustomEventType.UnsignedShortVec2]: 'ushortvec2',
  [CustomEventType.PriceInUSDCents]: 'price_usd_cent',
};

export type { CustomEventTypeValue };
export {
  CUSTOM_EVENT_BASE,
  CUSTOM_EVENT_DATA_TYPE_NAME,
  CUSTOM_EVENT_MIN_ID,
  CustomEventType,
  isCustomEventId,
};

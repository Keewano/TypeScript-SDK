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
 * Union of all valid `CustomEventType` numeric values.
 */
type CustomEventTypeValue = (typeof CustomEventType)[keyof typeof CustomEventType];

export type { CustomEventTypeValue };
export { CustomEventType };

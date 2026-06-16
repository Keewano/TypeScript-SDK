/**
 * Shared types for parsed custom-event definitions.
 *
 * The seven CustomEventType values are pinned to integer literals
 * because the server-side enum uses the same numbering. Re-declared
 * here (instead of imported from `@keewano/core`) so the codegen
 * package stays buildable without a runtime peer-dep on the SDK
 * package - it only needs the wire-shape constants, not the runtime
 * dispatcher implementation.
 */

/** Wire-protocol payload-shape tags for custom events; uint16 LE on the wire. */
const CustomEventType = {
  None: 0,
  String: 1,
  UnsignedInt: 2,
  Bool: 3,
  Timestamp: 4,
  UnsignedShortVec2: 5,
  PriceInUSDCents: 6,
} as const;

/** Union of all valid `CustomEventType` numeric values. */
type CustomEventTypeValue = (typeof CustomEventType)[keyof typeof CustomEventType];

const CUSTOM_EVENT_TYPE_NAMES: Readonly<Record<CustomEventTypeValue, string>> = {
  0: 'None',
  1: 'String',
  2: 'UnsignedInt',
  3: 'Bool',
  4: 'Timestamp',
  5: 'UnsignedShortVec2',
  6: 'PriceInUSDCents',
};

/** First wire id reserved for custom events; matches the server-side reservation. */
const FIRST_CUSTOM_EVENT_ID = 2500;

/**
 * On-disk JSON shape of a single event definition file.
 *
 * n - event name; must equal the file basename (without `.json`).
 * t - CustomEventType tag; the generator surfaces a human-friendly
 *   name via {@link CUSTOM_EVENT_TYPE_NAMES}.
 */
interface RawEventFile {
  n: string;
  t: CustomEventTypeValue;
}

/**
 * A validated event after parsing, sorting, and id assignment.
 *
 * name - event name (equals the source file basename).
 * type - CustomEventType tag carried over from the JSON `t` field.
 * id - wire event id = `FIRST_CUSTOM_EVENT_ID + sortedIndex`. Always
 *   `>= 2500` and stable as long as the input name set is stable.
 * sourceFile - absolute path of the JSON definition the entry was read
 *   from. Used in error messages.
 */
interface ParsedEvent {
  name: string;
  type: CustomEventTypeValue;
  id: number;
  sourceFile: string;
}

export type { CustomEventTypeValue, ParsedEvent, RawEventFile };
export { CUSTOM_EVENT_TYPE_NAMES, CustomEventType, FIRST_CUSTOM_EVENT_ID };

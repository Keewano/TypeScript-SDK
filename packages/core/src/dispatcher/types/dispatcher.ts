/**
 * Args / state types for the KEventDispatcher.
 */

import type { Codec, WireItem } from '../../codec/types/codec';

/**
 * Constructor args for {@link KEventDispatcher}.
 *
 * @property installId - 16-byte install UUID. Persisted across launches.
 * @property userId - 16-byte user UUID. May be all-zero before the
 *   game sets it via `setUserId`.
 * @property dataSessionId - 16-byte session UUID, fresh per launch.
 * @property initialTimestamp - Unix-seconds UTC value used as the
 *   first event-record header timestamp. Update with `setFrameTimestamp`.
 * @property codec - Batch encoding used by both accumulator builders.
 *   Defaults to the binary codec when omitted.
 * @property unrefTimers - When `true`, the idle `waitForSignal` timer is
 *   `unref`-ed so a parked send loop never keeps a Node process alive.
 *   Defaults to `false`; only the Node facade passes `true` (the host
 *   timer is a bare number on React Native / web, where it is a no-op).
 */
interface KEventDispatcherArgs {
  installId: Uint8Array;
  userId: Uint8Array;
  dataSessionId: Uint8Array;
  initialTimestamp: number;
  codec?: Codec;
  unrefTimers?: boolean;
}

/**
 * Args for the `addEventString` method.
 *
 * @property eventId - One of the `KEvents` values (uint16).
 * @property str - UTF-8 string payload. The dispatcher does not
 *   truncate; the public report layer pre-truncates short strings to
 *   256 bytes and passes long strings as-is.
 */
interface AddEventStringArgs {
  eventId: number;
  str: string;
}

/**
 * Args for the `addEventUint32` and `addEventInt32` methods.
 *
 * @property eventId - One of the `KEvents` values (uint16).
 * @property value - Numeric payload. uint32 accepts `[0, 2^32 - 1]`;
 *   int32 accepts `[-2^31, 2^31 - 1]`. Each method validates its own
 *   range when writing to the underlying `BinaryStream`.
 */
interface AddEventNumberArgs {
  eventId: number;
  value: number;
}

/**
 * Args for the `addEventUint16x2` method (used by `SCREEN_RESOLUTION`).
 *
 * @property eventId - One of the `KEvents` values (uint16).
 * @property x - First uint16 component.
 * @property y - Second uint16 component.
 */
interface AddEventUint16x2Args {
  eventId: number;
  x: number;
  y: number;
}

/**
 * Args for the `addEventDateTime` method.
 *
 * @property eventId - One of the `KEvents` values (uint16).
 * @property date - Either a JS `Date` or a Unix-seconds number. JS
 *   `Date.getTime()` returns milliseconds; the dispatcher converts to
 *   seconds via `Math.floor(date.getTime() / 1000)`.
 */
interface AddEventDateTimeArgs {
  eventId: number;
  date: Date | number;
}

/**
 * Args for the `addEventBool` method.
 *
 * @property eventId - One of the `KEvents` values (uint16).
 * @property flag - Boolean payload. Serialized as 0x02 (true) / 0x01 (false).
 */
interface AddEventBoolArgs {
  eventId: number;
  flag: boolean;
}

/**
 * Args for the `waitForSignal` method.
 *
 * @property timeoutMs - Maximum time to wait in milliseconds. The
 *   promise resolves with `true` if a signal arrived before the
 *   timeout, `false` otherwise.
 */
interface WaitForSignalArgs {
  timeoutMs: number;
}

/**
 * Args for the `addEventStringChar` method.
 *
 * @property eventId - One of the `KEvents` values (uint16).
 * @property str - Pre-truncated string payload.
 * @property charCode - Trailing byte code in [0, 255].
 */
interface AddEventStringCharArgs {
  eventId: number;
  str: string;
  charCode: number;
}

/**
 * Args for the `addEventStringItems` method.
 *
 * @property eventId - One of the `KEvents` values (uint16).
 * @property str - Pre-truncated label.
 * @property items - Pre-normalized wire items (filtered / truncated / clamped).
 */
interface AddEventStringItemsArgs {
  eventId: number;
  str: string;
  items: readonly WireItem[];
}

/**
 * Args for the `addEventStringItemsExchange` method.
 *
 * @property eventId - One of the `KEvents` values (uint16).
 * @property str - Pre-truncated label.
 * @property from - Pre-normalized items on the giving side.
 * @property to - Pre-normalized items on the receiving side.
 */
interface AddEventStringItemsExchangeArgs {
  eventId: number;
  str: string;
  from: readonly WireItem[];
  to: readonly WireItem[];
}

export type {
  AddEventBoolArgs,
  AddEventDateTimeArgs,
  AddEventNumberArgs,
  AddEventStringArgs,
  AddEventStringCharArgs,
  AddEventStringItemsArgs,
  AddEventStringItemsExchangeArgs,
  AddEventUint16x2Args,
  KEventDispatcherArgs,
  WaitForSignalArgs,
};

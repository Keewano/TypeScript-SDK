/**
 * Contracts for the pluggable batch-encoding layer.
 *
 * A `Codec` owns everything byte-shaped about a batch: how events are
 * encoded while they accumulate (`BatchBuilder`), how an accumulation
 * is split into shippable slices at event boundaries (`seal`), and how
 * a slice round-trips through persisted storage (`serializeContainer`
 * / `deserializeContainer`). The dispatcher and the send loop hold
 * policy only (thresholds, swap timing, retry cadence) and never touch
 * payload bytes directly.
 *
 * Two implementations are planned: the binary codec (the existing
 * wire format, byte-identical to the pre-seam implementation) and a
 * JSON codec for the REST ingestion API.
 */

/**
 * Identity and wire-stamp context shared by every slice sealed from
 * one accumulation.
 *
 * userId - 16-byte user UUID captured at seal time (a mid-batch
 *   setUserId applies to the whole sealed accumulation).
 * dataSessionId - 16-byte data-session UUID.
 * batchVersion - batch-format version stamp the container carries.
 * customEventsVersion - registered custom-events schema version, or 0
 *   when no schema is registered.
 */
interface BatchMetadata {
  userId: Uint8Array;
  dataSessionId: Uint8Array;
  batchVersion: number;
  customEventsVersion: number;
}

/**
 * One shippable unit produced by `BatchBuilder.seal`: a codec-encoded
 * payload spanning a contiguous run of whole events.
 *
 * payload - encoded event bytes for this slice only.
 * batchStartTime - Unix seconds (UTC) of the slice's first event.
 * batchEndTime - Unix seconds (UTC) the slice closes at: the cut
 *   point's last event time for an intermediate slice, the caller's
 *   `finalBatchEndTime` for the tail slice.
 */
interface EncodedBatchSlice {
  payload: Uint8Array;
  batchStartTime: number;
  batchEndTime: number;
}

/**
 * A fully-identified batch: what persistence stores and a transport
 * ships. Produced by pairing an `EncodedBatchSlice` with its metadata
 * and a loop-allocated batch number.
 *
 * codecId - id of the codec that encoded (or decoded) the payload;
 *   routes the batch to the matching transport.
 * metadata - identity + version context (see `BatchMetadata`).
 * batchNum - loop-allocated sequence number, unique per install.
 * batchStartTime - Unix seconds (UTC) of the first event.
 * batchEndTime - Unix seconds (UTC) the batch closes at.
 * payload - encoded event bytes (never the storage container).
 */
interface EncodedBatch {
  codecId: string;
  metadata: BatchMetadata;
  batchNum: number;
  batchStartTime: number;
  batchEndTime: number;
  payload: Uint8Array;
}

/**
 * Shared shape of every builder event: which event and when.
 *
 * eventId - wire event id (a `KEvents` value or a custom-event id).
 * timestamp - record timestamp, Unix seconds (UTC). The caller
 *   resolves it (frame timestamp policy lives in the dispatcher).
 */
interface BuilderEventArgs {
  eventId: number;
  timestamp: number;
}

/**
 * String-payload event. `str` - already validated and, where the
 * report layer requires it, already truncated.
 */
interface BuilderStringEventArgs extends BuilderEventArgs {
  str: string;
}

/** Numeric-payload event (uint32 or int32 per the method used). `value` - integer in the method's range. */
interface BuilderNumberEventArgs extends BuilderEventArgs {
  value: number;
}

/** Two-uint16 payload event. `x`, `y` - integers in [0, 65535]. */
interface BuilderUint16x2EventArgs extends BuilderEventArgs {
  x: number;
  y: number;
}

/** Date-payload event. `dateUnixSec` - payload date as Unix seconds (UTC), pre-normalized by the caller. */
interface BuilderDateTimeEventArgs extends BuilderEventArgs {
  dateUnixSec: number;
}

/** Bool-payload event. `flag` - the boolean payload. */
interface BuilderBoolEventArgs extends BuilderEventArgs {
  flag: boolean;
}

/** Float32-payload event. `value` - finite number, pre-clamped by the caller. */
interface BuilderFloatEventArgs extends BuilderEventArgs {
  value: number;
}

/**
 * String event with a trailing single-byte code (the A/B-test group
 * letter). `str` - pre-truncated label; `charCode` - integer in
 * [0, 255].
 */
interface BuilderStringCharEventArgs extends BuilderEventArgs {
  str: string;
  charCode: number;
}

/**
 * One inventory item as it goes on the wire. `name` - pre-truncated
 * item label; `count` - integer in the uint32 range, pre-clamped.
 */
interface WireItem {
  name: string;
  count: number;
}

/**
 * String event with one trailing items array (items granted / reset).
 * `str` - pre-truncated label; `items` - pre-normalized entries (the
 * report layer filters, truncates, and clamps before handing over).
 */
interface BuilderStringItemsEventArgs extends BuilderEventArgs {
  str: string;
  items: readonly WireItem[];
}

/**
 * String event with two trailing items arrays (items exchange).
 * `str` - pre-truncated label; `from` / `to` - pre-normalized sides
 * of the exchange, written back-to-back in that order.
 */
interface BuilderStringItemsExchangeEventArgs extends BuilderEventArgs {
  str: string;
  from: readonly WireItem[];
  to: readonly WireItem[];
}

/**
 * Seal parameters. `finalBatchEndTime` - Unix seconds (UTC) stamp for
 * the tail slice's close (the persist-time wall clock); intermediate
 * slices close at their own cut points.
 */
interface SealArgs {
  finalBatchEndTime: number;
}

/**
 * Incremental encoder for one accumulation. The dispatcher validates
 * inputs and resolves timestamps; the builder encodes, tracks the
 * encoded size, and records cut boundaries so `seal` can split the
 * accumulation into slices of whole events.
 *
 * Contract notes:
 * - `byteSize` is the encoded size so far; the dispatcher compares it
 *   against the wake threshold after every add.
 * - The builder records a cut boundary before an event when the bytes
 *   since the previous cut reach the cut threshold it was created
 *   with, so a cut never lands mid-event (composite reports stay in
 *   one slice).
 * - `seal` returns one slice per cut span plus the tail; an empty
 *   accumulation seals to an empty array.
 * - `reset` returns the builder to the empty state without dropping
 *   its identity so the double-buffer swap can reuse it.
 */
interface BatchBuilder {
  addEvent(args: BuilderEventArgs): void;
  addEventString(args: BuilderStringEventArgs): void;
  addEventUint32(args: BuilderNumberEventArgs): void;
  addEventInt32(args: BuilderNumberEventArgs): void;
  addEventUint8(args: BuilderNumberEventArgs): void;
  addEventUint16x2(args: BuilderUint16x2EventArgs): void;
  addEventDateTime(args: BuilderDateTimeEventArgs): void;
  addEventBool(args: BuilderBoolEventArgs): void;
  addEventFloat32(args: BuilderFloatEventArgs): void;
  addEventStringChar(args: BuilderStringCharEventArgs): void;
  addEventStringItems(args: BuilderStringItemsEventArgs): void;
  addEventStringItemsExchange(args: BuilderStringItemsExchangeEventArgs): void;
  byteSize(): number;
  seal(args: SealArgs): EncodedBatchSlice[];
  reset(): void;
}

/**
 * Builder construction parameters. `cutThresholdBytes` - encoded-byte
 * span after which the builder records a cut boundary before the next
 * event.
 */
interface CreateBuilderArgs {
  cutThresholdBytes: number;
}

/**
 * A batch encoding: builder factory plus the persisted-container
 * round-trip.
 *
 * Contract notes:
 * - `id` names the encoding (for example 'binary'); it travels on
 *   every `EncodedBatch` and routes a loaded batch to the matching
 *   transport.
 * - `serializeContainer` produces the storable byte form of a batch
 *   (payload + metadata envelope). For the binary codec this is the
 *   existing on-disk container format, byte-identical.
 * - `deserializeContainer` is the strict inverse; it returns `null`
 *   on any corruption (truncation, bad magic, inconsistent sizes) so
 *   the send loop can skip bad files without classifying errors.
 * - `deserializeContainer` implementations MUST return owned buffers:
 *   the payload and identity fields must not alias the input bytes,
 *   so callers may hold results past the source buffer's lifetime.
 */
interface Codec {
  readonly id: string;
  createBuilder(args: CreateBuilderArgs): BatchBuilder;
  serializeContainer(batch: EncodedBatch): Uint8Array;
  deserializeContainer(bytes: Uint8Array): EncodedBatch | null;
}

export type {
  BatchBuilder,
  BatchMetadata,
  BuilderBoolEventArgs,
  BuilderDateTimeEventArgs,
  BuilderEventArgs,
  BuilderFloatEventArgs,
  BuilderNumberEventArgs,
  BuilderStringCharEventArgs,
  BuilderStringEventArgs,
  BuilderStringItemsEventArgs,
  BuilderStringItemsExchangeEventArgs,
  BuilderUint16x2EventArgs,
  Codec,
  CreateBuilderArgs,
  EncodedBatch,
  EncodedBatchSlice,
  SealArgs,
  WireItem,
};

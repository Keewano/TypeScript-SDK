/**
 * The JSON implementation of the `Codec` contract: encodes batches
 * for the REST ingestion API (`POST /event/ingress/v1/json/in`).
 *
 * - Each event encodes as a compact JSON object
 *   `{"eventTypeId":N,"timestamp":T,"data":...}`; `data` is omitted
 *   entirely for no-payload events, matching the server's published
 *   example. For built-in events JSON's native types carry the payload
 *   typing (string, number, boolean, object) and nothing else is sent.
 * - A custom event additionally carries `dataType`, its declared
 *   payload shape. The ingestion service validates each custom event
 *   against the name the event itself carries and never against the
 *   registered map, so an event without one is dropped while the rest
 *   of the batch is accepted.
 * - A slice payload is the UTF-8 bytes of comma-separated event
 *   objects WITHOUT the enclosing `[` `]` - the paired transport
 *   splices it into the request envelope's `events` array verbatim,
 *   so payload bytes are never re-parsed on the send path.
 * - Cut bookkeeping mirrors the binary codec: a cut is recorded at
 *   the boundary BEFORE an event when the encoded bytes since the
 *   previous cut reach the threshold, so a cut never lands mid-event
 *   and a composite report never straddles two slices.
 * - Composite payload field names come from the ingestion API's event
 *   catalog and differ per event: the label of an items payload is a
 *   product, a placement, a package or a point in the economy
 *   depending on which event carries it, so the name is looked up by
 *   event id rather than shared across the shape.
 */

import type { CustomEventSet } from '../network/types/customEventSet';
import type {
  BatchBuilder,
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
} from './types/codec';

import { CUSTOM_EVENT_DATA_TYPE_NAME } from '../events/customEventType';
import { customEventIdAt } from '../events/customEventId';
import { KEvents } from '../events/kevents';
import { uuidBytesToString, uuidToBytes } from '../encoding/uuid';

/** Codec id stamped on every batch this codec encodes or decodes. */
const JSON_CODEC_ID = 'json';

/** Version stamp of the persisted JSON container format. */
const JSON_CONTAINER_VERSION = 1;

/** TextEncoder/TextDecoder are stateless; allocate once at module load. */
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

/**
 * Internal cut bookkeeping: `eventIndex` - index of the event the
 * next slice starts with; `lastEventTime` - timestamp of the event
 * the closed span ends with.
 */
interface CutPoint {
  eventIndex: number;
  lastEventTime: number;
}

/** Arguments of {@link encodeEventJson}. */
interface EncodeEventJsonArgs {
  eventId: number;
  timestamp: number;
  dataType?: string;
  data?: unknown;
}

/**
 * Serialize one event object in the fixed compact shape. `data` is
 * appended only when a payload exists - `undefined` means "no
 * payload", and the field is dropped rather than sent as null.
 * `dataType` is present only on custom events, whose declared
 * payload shape the server reads off the event itself.
 */
function encodeEventJson({ eventId, timestamp, dataType, data }: EncodeEventJsonArgs): Uint8Array {
  const head = `{"eventTypeId":${eventId},"timestamp":${timestamp}`;
  const type = dataType === undefined ? '' : `,"dataType":${JSON.stringify(dataType)}`;
  const tail = data === undefined ? '}' : `,"data":${JSON.stringify(data)}}`;
  return utf8Encoder.encode(head + type + tail);
}

/**
 * Wire dataType name per custom event id, derived from the declared
 * set. Built-in ids are absent by construction, which is what keeps
 * the name off events that must not carry one.
 */
function customDataTypesOf(set: CustomEventSet | undefined): ReadonlyMap<number, string> {
  const byId = new Map<number, string>();
  for (const [index, def] of (set?.events ?? []).entries()) {
    const name = CUSTOM_EVENT_DATA_TYPE_NAME[def.type];
    if (name !== undefined) byId.set(customEventIdAt({ declaredId: def.id, index }), name);
  }
  return byId;
}

/** Map a wire items array to its JSON form (already normalized by the report layer). */
function itemsToJson(items: readonly WireItem[]): Array<{ name: string; count: number }> {
  return items.map((item) => ({ name: item.name, count: item.count }));
}

/**
 * The label field of a composite payload is named per event type, not
 * per shape: the same string means a product, a placement, a package
 * or a point in the economy depending on which event carries it. The
 * binary format never needed this because it writes the value
 * positionally.
 */
const COMPOSITE_LABEL_FIELD: Readonly<Record<number, string>> = {
  [KEvents.ITEMS_EXCHANGE]: 'exchange_point',
  [KEvents.ITEMS_RESET]: 'reset_point',
  [KEvents.ITEMS_PURCHASED_GRANT]: 'product_id',
  [KEvents.ITEMS_AD_GRANTED]: 'placement',
  [KEvents.ITEMS_SUBSCRIPTION_GRANTED]: 'package',
};

/**
 * An event routed through a composite builder without an entry above
 * would ship under a field name the server does not read, and the
 * batch would be accepted with the value silently discarded. Fail
 * instead, so a new composite event cannot reach a customer unmapped.
 */
function compositeLabelField(eventId: number): string {
  const field = COMPOSITE_LABEL_FIELD[eventId];
  if (field === undefined) {
    throw new RangeError(`jsonCodec: no label field for composite event ${String(eventId)}`);
  }
  return field;
}

/** Arguments of the JSON builder: the shared contract plus the custom-event name table. */
interface JsonBuilderArgs extends CreateBuilderArgs {
  customDataTypes: ReadonlyMap<number, string>;
}

class JsonBatchBuilder implements BatchBuilder {
  private readonly cutThresholdBytes: number;
  private readonly customDataTypes: ReadonlyMap<number, string>;
  private events: Uint8Array[];
  private totalEventBytes: number;
  private cutPositions: CutPoint[];
  private bytesAtLastCut: number;
  private batchStartTime: number;
  private batchEndTime: number;

  constructor({ cutThresholdBytes, customDataTypes }: JsonBuilderArgs) {
    this.cutThresholdBytes = cutThresholdBytes;
    this.customDataTypes = customDataTypes;
    this.events = [];
    this.totalEventBytes = 0;
    this.cutPositions = [];
    this.bytesAtLastCut = 0;
    this.batchStartTime = 0;
    this.batchEndTime = 0;
  }

  /** Event bytes, stamped with the declared payload type when the id is a custom one. */
  private encode(args: EncodeEventJsonArgs): Uint8Array {
    const dataType = this.customDataTypes.get(args.eventId);
    return encodeEventJson(dataType === undefined ? args : { ...args, dataType });
  }

  addEvent({ eventId, timestamp }: BuilderEventArgs): void {
    this.push(timestamp, this.encode({ eventId, timestamp }));
  }

  addEventString({ eventId, timestamp, str }: BuilderStringEventArgs): void {
    this.push(timestamp, this.encode({ eventId, timestamp, data: str }));
  }

  addEventUint32({ eventId, timestamp, value }: BuilderNumberEventArgs): void {
    this.push(timestamp, this.encode({ eventId, timestamp, data: value }));
  }

  addEventInt32({ eventId, timestamp, value }: BuilderNumberEventArgs): void {
    this.push(timestamp, this.encode({ eventId, timestamp, data: value }));
  }

  addEventUint8({ eventId, timestamp, value }: BuilderNumberEventArgs): void {
    this.push(timestamp, this.encode({ eventId, timestamp, data: value }));
  }

  /**
   * Full JS double precision goes on the wire - JSON has no float32,
   * and the server's own example uses a plain decimal (4.59). The
   * binary wire quantizes the same value to float32; the JSON path is
   * deliberately the more precise of the two.
   */
  addEventFloat32({ eventId, timestamp, value }: BuilderFloatEventArgs): void {
    this.push(timestamp, this.encode({ eventId, timestamp, data: value }));
  }

  addEventStringChar({ eventId, timestamp, str, charCode }: BuilderStringCharEventArgs): void {
    this.push(
      timestamp,
      this.encode({
        eventId,
        timestamp,
        data: {
          test_name: str,
          group: String.fromCodePoint(charCode),
        },
      }),
    );
  }

  addEventStringItems({ eventId, timestamp, str, items }: BuilderStringItemsEventArgs): void {
    this.push(
      timestamp,
      this.encode({
        eventId,
        timestamp,
        data: {
          [compositeLabelField(eventId)]: str,
          items: itemsToJson(items),
        },
      }),
    );
  }

  addEventStringItemsExchange({
    eventId,
    timestamp,
    str,
    from,
    to,
  }: BuilderStringItemsExchangeEventArgs): void {
    this.push(
      timestamp,
      this.encode({
        eventId,
        timestamp,
        data: {
          [compositeLabelField(eventId)]: str,
          from: itemsToJson(from),
          to: itemsToJson(to),
        },
      }),
    );
  }

  addEventUint16x2({ eventId, timestamp, x, y }: BuilderUint16x2EventArgs): void {
    this.push(timestamp, this.encode({ eventId, timestamp, data: { x, y } }));
  }

  addEventDateTime({ eventId, timestamp, dateUnixSec }: BuilderDateTimeEventArgs): void {
    this.push(timestamp, this.encode({ eventId, timestamp, data: dateUnixSec }));
  }

  addEventBool({ eventId, timestamp, flag }: BuilderBoolEventArgs): void {
    this.push(timestamp, this.encode({ eventId, timestamp, data: flag }));
  }

  /** Encoded bytes so far: event objects plus one separator comma between each pair. */
  byteSize(): number {
    return this.events.length === 0 ? 0 : this.totalEventBytes + this.events.length - 1;
  }

  /**
   * Split the accumulation into slices of whole events along the
   * recorded cut points, joining each span's events with commas.
   * Interval clamping mirrors the binary codec: every slice end is
   * clamped up to its own start, and the clamped value seeds the next
   * slice's start, so a backward wall-clock move can never emit an
   * inverted or overlapping interval.
   */
  seal({ finalBatchEndTime }: SealArgs): EncodedBatchSlice[] {
    if (this.events.length === 0) {
      return [];
    }
    const slices: EncodedBatchSlice[] = [];
    let fromIndex = 0;
    let sliceStart = this.batchStartTime;
    for (const cut of this.cutPositions) {
      const clampedEndTime = Math.max(sliceStart, cut.lastEventTime);
      if (cut.eventIndex > fromIndex) {
        slices.push({
          payload: this.joinSpan(fromIndex, cut.eventIndex),
          batchStartTime: sliceStart,
          batchEndTime: clampedEndTime,
        });
      }
      fromIndex = cut.eventIndex;
      sliceStart = clampedEndTime;
    }
    if (fromIndex < this.events.length) {
      slices.push({
        payload: this.joinSpan(fromIndex, this.events.length),
        batchStartTime: sliceStart,
        batchEndTime: Math.max(sliceStart, finalBatchEndTime),
      });
    }
    return slices;
  }

  reset(): void {
    this.events = [];
    this.totalEventBytes = 0;
    this.cutPositions = [];
    this.bytesAtLastCut = 0;
    this.batchStartTime = 0;
    this.batchEndTime = 0;
  }

  /** Concatenate events `[from, to)` with `,` separators into one owned buffer. */
  private joinSpan(from: number, to: number): Uint8Array {
    let size = to - from - 1;
    for (let i = from; i < to; i += 1) {
      size += this.events[i]?.length ?? 0;
    }
    const out = new Uint8Array(size);
    let offset = 0;
    for (let i = from; i < to; i += 1) {
      if (i > from) {
        out[offset] = 0x2c;
        offset += 1;
      }
      const event = this.events[i];
      if (event !== undefined) {
        out.set(event, offset);
        offset += event.length;
      }
    }
    return out;
  }

  /**
   * Record a pending cut at the boundary BEFORE this event, mark the
   * batch start on the first event, advance the end stamp, then store
   * the encoded bytes. Order matters: the cut decision uses the
   * pre-event size and the PREVIOUS event's timestamp, exactly as the
   * binary builder does.
   */
  private push(timestamp: number, encoded: Uint8Array): void {
    const currentSize = this.byteSize();
    if (currentSize - this.bytesAtLastCut >= this.cutThresholdBytes) {
      this.cutPositions.push({
        eventIndex: this.events.length,
        lastEventTime: this.batchEndTime,
      });
      this.bytesAtLastCut = currentSize;
    }
    if (this.events.length === 0) {
      this.batchStartTime = timestamp;
    }
    this.batchEndTime = timestamp;
    this.events.push(encoded);
    this.totalEventBytes += encoded.length;
  }
}

/**
 * `true` for a plain parsed-JSON object (not an array, not null) -
 * the only shape a container or an event record may take.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `true` for an integer inside the uint32 wire domain. Every numeric
 * container field (and event id / timestamp) is a uint32 in the
 * binary container, where the fixed-width read enforces the domain
 * physically; the JSON container must enforce the same bounds
 * explicitly or out-of-domain values from a corrupted file would
 * re-enter the send pipeline as apparently valid batches.
 */
function isUint32Field(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_UINT32
  );
}

/**
 * Parse a canonical UUID string into bytes, or `null` when the value
 * is not a valid UUID string.
 */
function parseUuidField(value: unknown): Uint8Array | null {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return uuidToBytes(value);
  } catch {
    return null;
  }
}

/**
 * Re-encode the container's parsed `events` array back into slice
 * payload bytes, or `null` when any element is not an event record.
 * `JSON.stringify` on a just-parsed object reproduces this codec's
 * own compact output byte-for-byte (key insertion order is
 * preserved), so a round trip through the container is lossless for
 * containers this codec wrote.
 */
function eventsToPayload(events: unknown): Uint8Array | null {
  if (!Array.isArray(events)) {
    return null;
  }
  const parts: string[] = [];
  for (const event of events) {
    if (
      !isPlainObject(event) ||
      !isUint32Field(event['eventTypeId']) ||
      !isUint32Field(event['timestamp'])
    ) {
      return null;
    }
    parts.push(JSON.stringify(event));
  }
  return utf8Encoder.encode(parts.join(','));
}

/** Arguments of the JSON codec: the declared custom-event set, when the host passed one. */
interface JsonCodecArgs {
  customEventSet?: CustomEventSet;
}

class JsonCodec implements Codec {
  readonly id = JSON_CODEC_ID;

  private readonly customDataTypes: ReadonlyMap<number, string>;

  constructor(args?: JsonCodecArgs) {
    this.customDataTypes = customDataTypesOf(args?.customEventSet);
  }

  /**
   * Getter with lazy measurement: a module-scope computation would be
   * a side effect that pins this module into every bundle importing
   * the core barrel, tree-shaken or not. The first access measures,
   * later accesses reuse the cached value.
   */
  get tombstoneCeilingBytes(): number {
    jsonTombstoneCeiling ??= measureTombstoneCeiling();
    return jsonTombstoneCeiling;
  }

  createBuilder(args: CreateBuilderArgs): BatchBuilder {
    return new JsonBatchBuilder({ ...args, customDataTypes: this.customDataTypes });
  }

  /**
   * Compose the persisted container: a single JSON object carrying
   * the batch identity fields plus the payload spliced in as the
   * `events` array. The payload is spliced as text, never re-parsed,
   * so the container write stays O(payload) with no JSON round trip.
   */
  serializeContainer(batch: EncodedBatch): Uint8Array {
    /**
     * Mirror the binary codec's boundary guard: `set`/decode on a
     * plain number array would silently corrupt the container.
     */
    if (!(batch.payload instanceof Uint8Array)) {
      throw new TypeError('serializeContainer: payload must be a Uint8Array');
    }
    const head = JSON.stringify({
      containerVersion: JSON_CONTAINER_VERSION,
      codecId: JSON_CODEC_ID,
      userId: uuidBytesToString(batch.metadata.userId),
      dataSessionId: uuidBytesToString(batch.metadata.dataSessionId),
      batchVersion: batch.metadata.batchVersion,
      customEventsVersion: batch.metadata.customEventsVersion,
      batchNum: batch.batchNum,
      batchStartTime: batch.batchStartTime,
      batchEndTime: batch.batchEndTime,
    });
    const text = `${head.slice(0, -1)},"events":[${utf8Decoder.decode(batch.payload)}]}`;
    return utf8Encoder.encode(text);
  }

  /**
   * Strict inverse of {@link serializeContainer}. Returns `null` on
   * any corruption: unparseable JSON, wrong container version or
   * codec id, malformed UUIDs, non-integer numeric fields, an
   * inverted time interval, or an `events` array with anything but
   * event records in it. All returned buffers are owned - nothing
   * aliases the input bytes.
   */
  deserializeContainer(bytes: Uint8Array): EncodedBatch | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(utf8Decoder.decode(bytes));
    } catch {
      return null;
    }
    if (!isPlainObject(parsed)) {
      return null;
    }
    if (
      parsed['containerVersion'] !== JSON_CONTAINER_VERSION ||
      parsed['codecId'] !== JSON_CODEC_ID
    ) {
      return null;
    }
    const userId = parseUuidField(parsed['userId']);
    const dataSessionId = parseUuidField(parsed['dataSessionId']);
    if (userId === null || dataSessionId === null) {
      return null;
    }
    const batchVersion = parsed['batchVersion'];
    const customEventsVersion = parsed['customEventsVersion'];
    const batchNum = parsed['batchNum'];
    const batchStartTime = parsed['batchStartTime'];
    const batchEndTime = parsed['batchEndTime'];
    if (
      !isUint32Field(batchVersion) ||
      !isUint32Field(customEventsVersion) ||
      !isUint32Field(batchNum) ||
      !isUint32Field(batchStartTime) ||
      !isUint32Field(batchEndTime)
    ) {
      return null;
    }
    /**
     * The binary header reader rejects inverted intervals; both
     * container formats must share one validity domain.
     */
    if (batchEndTime < batchStartTime) {
      return null;
    }
    const payload = eventsToPayload(parsed['events']);
    if (payload === null) {
      return null;
    }
    return {
      codecId: JSON_CODEC_ID,
      metadata: { userId, dataSessionId, batchVersion, customEventsVersion },
      batchNum,
      batchStartTime,
      batchEndTime,
      payload,
    };
  }
}

/** Upper bound of the uint32 wire domain; also maxes every field for the ceiling measurement. */
const MAX_UINT32 = 4294967295;

/**
 * A tombstone is what the storage cap leaves behind when the queue
 * outgrows its disk budget: rather than deleting a batch outright and
 * leaving a silent hole in the data, the cap rewrites it as a batch
 * of one `BATCH_DROPPED` event that keeps the original identity and
 * timing, so the server learns that a specific session lost data
 * instead of merely never hearing about it. It is the smallest batch
 * this codec can produce.
 *
 * The cap pass needs a size below which a file is already tombstoned
 * and not worth rewriting. Measuring it by serializing a real one
 * with every variable-width field at its maximum (uint32 fields at 10
 * digits; UUIDs are fixed-width) keeps that number honest: any change
 * to the container or event shape re-measures itself.
 */
function measureTombstoneCeiling(): number {
  const codec = new JsonCodec();
  const builder = codec.createBuilder({ cutThresholdBytes: 1024 });
  builder.addEventUint32({
    eventId: KEvents.BATCH_DROPPED,
    timestamp: MAX_UINT32,
    value: MAX_UINT32,
  });
  const slice = builder.seal({ finalBatchEndTime: MAX_UINT32 })[0];
  if (slice === undefined) {
    throw new Error('measureTombstoneCeiling: tombstone sealed to no slice');
  }
  const maxUuid = uuidToBytes('ffffffff-ffff-ffff-ffff-ffffffffffff');
  return codec.serializeContainer({
    codecId: JSON_CODEC_ID,
    metadata: {
      userId: maxUuid,
      dataSessionId: maxUuid,
      batchVersion: MAX_UINT32,
      customEventsVersion: MAX_UINT32,
    },
    batchNum: MAX_UINT32,
    batchStartTime: MAX_UINT32,
    batchEndTime: MAX_UINT32,
    payload: slice.payload,
  }).length;
}

let jsonTombstoneCeiling: number | null = null;

export { JSON_CODEC_ID, JsonCodec };
